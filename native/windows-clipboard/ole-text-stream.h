/**
 * 模块职责（中文）：把可变 IStream 内容捕获为独占 HGLOBAL 字节，按最新规则和精确终止位置检查后才输出新流；不把已检查却共享底层存储的 clone 交给消费者。
 * Module responsibilities (English): Capture mutable IStream into exclusive HGLOBAL bytes, checking current rules/exact termination before producing a new stream instead of delivering a checked clone whose backing is shared.
 */
/** OLE 文本媒介检查与 IStream 快照：复制已验证字节为独立输出，避免共享后端在检查后改变数据。 */
#pragma once

// IDataObject::GetData returns the bytes from offset zero to the stream's
// current seek pointer. Clone has a separate cursor but shares its backing
// bytes, so never return that clone after checking it: make an owned snapshot.
// https://learn.microsoft.com/windows/win32/api/objidl/nf-objidl-idataobject-getdatahere
// https://learn.microsoft.com/windows/win32/api/objidl/nf-objidl-istream-clone
struct ClipboardTextStream {
  HGLOBAL bytes=nullptr;
  ULONG length=0;
  /** 中文：保留此资源持有类型的默认构造，成员使用声明处的空句柄/空缓冲区初值，尚未取得需要释放的资源。 English: Retain the resource holder's default constructor, using null handle/buffer member initializers without acquiring a resource to release yet. */
  ClipboardTextStream()=default;
  /** 中文：删除此类型的复制构造，避免裸句柄或自有缓冲区被多个对象重复释放；传入对象不能通过此声明复制。 English: Delete this type's copy constructor to prevent multiple objects releasing the same raw handle/owned buffer; the supplied object cannot be copied through this declaration. 参数声明 / Declared parameters: const ClipboardTextStream&. */
  ClipboardTextStream(const ClipboardTextStream&)=delete;
  /** 中文：删除此类型的复制赋值，避免裸句柄或自有缓冲区被多个对象重复释放；传入对象不能通过此声明复制。 English: Delete this type's copy assignment to prevent multiple objects releasing the same raw handle/owned buffer; the supplied object cannot be copied through this declaration. 参数声明 / Declared parameters: const ClipboardTextStream&. */
  ClipboardTextStream& operator=(const ClipboardTextStream&)=delete;
  /** 中文：释放尚未交给输出流的自有 HGLOBAL，避免捕获或验证失败泄漏。 English: Free owned HGLOBAL not yet transferred to an output stream, including capture/validation failures. */
  ~ClipboardTextStream(){if(bytes)GlobalFree(bytes);}

  /** 中文：克隆输入游标后有界读取完整内容到独占 HGLOBAL，保留原流游标；不信任 clone 的共享底层存储，短读/超限/API 失败以 HRESULT 返回。 English: Clone the input cursor and boundedly capture complete contents into exclusive HGLOBAL while preserving the original cursor; distrust clone's shared backing and report short reads/overflow/API failures via HRESULT. 参数声明 / Declared parameters: IStream* source,uint32_t maximum. */
  HRESULT capture(IStream* source,uint32_t maximum) {
    if(!source || bytes)return DV_E_TYMED;
    IStream* clone=nullptr;
    HRESULT answer=source->Clone(&clone);
    if(FAILED(answer) || !clone){if(clone)clone->Release();return FAILED(answer)?answer:E_UNEXPECTED;}
    LARGE_INTEGER zero{};ULARGE_INTEGER end{};
    answer=clone->Seek(zero,STREAM_SEEK_CUR,&end);
    if(SUCCEEDED(answer) && (!end.QuadPart || end.QuadPart>uint64_t(maximum)*4+8))answer=STG_E_MEDIUMFULL;
    if(SUCCEEDED(answer))answer=clone->Seek(zero,STREAM_SEEK_SET,nullptr);
    if(SUCCEEDED(answer)){
      length=ULONG(end.QuadPart);
      bytes=GlobalAlloc(GMEM_MOVEABLE,length);
      if(!bytes)answer=E_OUTOFMEMORY;
    }
    void* target=SUCCEEDED(answer)?GlobalLock(bytes):nullptr;
    if(SUCCEEDED(answer) && !target)answer=E_OUTOFMEMORY;
    ULONG position=0;
    while(SUCCEEDED(answer) && position<length){
      const ULONG wanted=std::min<ULONG>(65536,length-position);ULONG received=0;
      answer=clone->Read(static_cast<unsigned char*>(target)+position,wanted,&received);
      if(SUCCEEDED(answer) && (received!=wanted || (answer!=S_OK && answer!=S_FALSE)))answer=STG_E_READFAULT;
      if(SUCCEEDED(answer))position+=received;
    }
    if(target)GlobalUnlock(bytes);
    clone->Release();
    return FAILED(answer)?answer:S_OK;
  }

  /** 中文：检查私有快照文本策略并要求首个 NUL 恰为最后字符，拒绝尾随隐藏内容或错误宽字符对齐。 English: Check policy on private text bytes and require the first NUL to be the final character, rejecting hidden suffixes or invalid wide alignment. 参数声明 / Declared parameters: UINT format,const Rule& rule. */
  bool allowed(UINT format,const Rule& rule) const {
    if(!bytes || !length || !plainFormat(format) || !contentAllowed(format,bytes,rule))return false;
    // Stream consumers can read every byte. Reject a suffix hidden after the
    // first text terminator instead of approving only its visible prefix.
    const void* data=GlobalLock(bytes);if(!data)return false;
    bool complete=false;
    if(format==CF_UNICODETEXT && length%sizeof(wchar_t)==0){
      const auto first=static_cast<const wchar_t*>(data),end=first+length/sizeof(wchar_t);
      complete=std::find(first,end,L'\0')==end-1;
    }else if(format!=CF_UNICODETEXT){
      const auto first=static_cast<const char*>(data),end=first+length;
      complete=std::find(first,end,'\0')==end-1;
    }
    GlobalUnlock(bytes);return complete;
  }

  /** 中文：将已捕获 HGLOBAL 所有权交给删除时释放的 IStream，设置精确逻辑长度并定位末尾，防止暴露分配器填充字节。 English: Transfer captured HGLOBAL to a delete-on-release IStream, set exact logical length and seek to the end so allocation padding is not exposed. 参数声明 / Declared parameters: STGMEDIUM* medium. */
  HRESULT releaseTo(STGMEDIUM* medium) {
    IStream* stream=nullptr;
    HRESULT answer=CreateStreamOnHGlobal(bytes,TRUE,&stream);
    if(FAILED(answer))return answer;
    bytes=nullptr; // The private stream now owns the allocation.
    ULARGE_INTEGER size{};size.QuadPart=length;
    answer=stream->SetSize(size); // GlobalAlloc may round up; expose exact bytes.
    LARGE_INTEGER end{};end.QuadPart=length;
    if(SUCCEEDED(answer))answer=stream->Seek(end,STREAM_SEEK_SET,nullptr);
    if(FAILED(answer)){stream->Release();return answer;}
    *medium={};medium->tymed=TYMED_ISTREAM;medium->pstm=stream;return S_OK;
  }
};

/** 中文：检查最新方向/格式，HGLOBAL 核验文本；活动文本 IStream 必须走独立快照通道，其他允许格式沿既有 medium 分支处理。 English: Check current direction/format and validate HGLOBAL text; active text IStream requires a separate snapshot path, while other permitted formats follow existing medium handling. 参数声明 / Declared parameters: UINT format,const STGMEDIUM& medium,bool copy. */
static bool clipboardMediumAllowed(UINT format,const STGMEDIUM& medium,bool copy) {
  const auto rule=current();
  if(!directionAllowed(copy,rule) || !formatAllowed(format,rule))return false;
  if(!rule.active)return true;
  if(medium.tymed==TYMED_HGLOBAL)return medium.hGlobal && contentAllowed(format,medium.hGlobal,rule);
  if(!plainFormat(format))return true;
  return false; // Plain streams require an owned snapshot, handled below.
}

/** 中文：只接受普通文本 IStream，捕获有界私有副本后重读方向和内容规则，将合格快照交付输出；失败保留原 medium 所有权。 English: Accept only plain-text IStream, capture a bounded private copy and reread direction/content rules before delivery; failure retains original medium ownership. 参数声明 / Declared parameters: UINT format,const STGMEDIUM& source,bool copy,STGMEDIUM* out. */
static HRESULT clipboardSnapshotStream(UINT format,const STGMEDIUM& source,bool copy,STGMEDIUM* out) {
  *out={};
  const auto before=current();
  if(!directionAllowed(copy,before) || !formatAllowed(format,before))return E_ACCESSDENIED;
  if(source.tymed!=TYMED_ISTREAM || !plainFormat(format))return DV_E_TYMED;
  ClipboardTextStream snapshot;
  const HRESULT captured=snapshot.capture(source.pstm,before.active?before.maximum:1048576);
  if(FAILED(captured))return captured;
  const auto latest=current();
  if(!directionAllowed(copy,latest) || !snapshot.allowed(format,latest))return E_ACCESSDENIED;
  return snapshot.releaseTo(out);
}
