#pragma once

// IDataObject::GetData returns the bytes from offset zero to the stream's
// current seek pointer. Clone has a separate cursor but shares its backing
// bytes, so never return that clone after checking it: make an owned snapshot.
// https://learn.microsoft.com/windows/win32/api/objidl/nf-objidl-idataobject-getdatahere
// https://learn.microsoft.com/windows/win32/api/objidl/nf-objidl-istream-clone
struct ClipboardTextStream {
  HGLOBAL bytes=nullptr;
  ULONG length=0;
  ClipboardTextStream()=default;
  ClipboardTextStream(const ClipboardTextStream&)=delete;
  ClipboardTextStream& operator=(const ClipboardTextStream&)=delete;
  ~ClipboardTextStream(){if(bytes)GlobalFree(bytes);}

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

static bool clipboardMediumAllowed(UINT format,const STGMEDIUM& medium,bool copy) {
  const auto rule=current();
  if(!directionAllowed(copy,rule) || !formatAllowed(format,rule))return false;
  if(!rule.active)return true;
  if(medium.tymed==TYMED_HGLOBAL)return medium.hGlobal && contentAllowed(format,medium.hGlobal,rule);
  if(!plainFormat(format))return true;
  return false; // Plain streams require an owned snapshot, handled below.
}

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
