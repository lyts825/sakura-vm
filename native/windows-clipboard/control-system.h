/**
 * 模块职责（中文）：核对 comctl32 的系统目录或受保护、匹配架构 WinSxS 来源；控制器和策略共用同一可信路径判定，不仅依据 DLL 名称。
 * Module responsibilities (English): Verify comctl32 system-directory or protected architecture-matched WinSxS provenance, sharing the same trusted-path decision between controller and policy rather than trusting a DLL name alone.
 */
/** 核对可信 Windows 系统模块路径，供原生控制器和策略库判断系统组件来源。 */
#pragma once
#include <windows.h>
#include <string>

// comctl32 is not a KnownDLL on every supported Windows release. Permit only
// the OS system image or Windows' protected, architecture-matched Common
// Controls assembly, never an application/private assembly with the same name.
/** 中文：忽略大小写按序数比较系统模块路径，避免区域规则影响可信来源判断。 English: Compare system paths ordinally/case-insensitively so locale rules cannot alter trusted-origin decisions. 参数声明 / Declared parameters: const std::wstring& first,const std::wstring& second. */
static bool controlSystemEqual(const std::wstring& first,const std::wstring& second) {
  return CompareStringOrdinal(first.c_str(),-1,second.c_str(),-1,TRUE)==CSTR_EQUAL;
}
/** 中文：只在长度足够时按序数核对前缀，供可信 WinSxS 目录匹配。 English: Compare an ordinal prefix only with sufficient length for trusted WinSxS directory matching. 参数声明 / Declared parameters: const std::wstring& value,const std::wstring& prefix. */
static bool controlSystemPrefix(const std::wstring& value,const std::wstring& prefix) {
  return value.size()>=prefix.size() && CompareStringOrdinal(value.data(),int(prefix.size()),prefix.data(),int(prefix.size()),TRUE)==CSTR_EQUAL;
}
/** 中文：要求当前架构、固定 Common Controls 公钥目录、正确 manifest/DLL 后缀及受限组件字符，拒绝私有同名程序集。 English: Require current architecture/fixed Common Controls public-key directory/proper manifest-DLL suffix/bounded component characters, rejecting private same-name assemblies. 参数声明 / Declared parameters: const std::wstring& path,bool manifest. */
static bool controlSystemAssembly(const std::wstring& path,bool manifest) {
  wchar_t windows[MAX_PATH]{};
  const UINT length=GetSystemWindowsDirectoryW(windows,MAX_PATH);
  if(!length || length>=MAX_PATH)return false;
  const std::wstring prefix=std::wstring(windows)+(manifest?L"\\WinSxS\\Manifests\\":L"\\WinSxS\\")+
    (sizeof(void*)==4?L"x86":L"amd64")+L"_microsoft.windows.common-controls_6595b64144ccf1df_";
  const std::wstring suffix=manifest?L".manifest":L"\\comctl32.dll";
  if(!controlSystemPrefix(path,prefix) || path.size()<=prefix.size()+suffix.size() ||
      !controlSystemEqual(path.substr(path.size()-suffix.size()),suffix))return false;
  const auto component=path.substr(prefix.size(),path.size()-prefix.size()-suffix.size());
  if(component.size()>256)return false;
  for(const wchar_t character:component)
    if(!((character>=L'0'&&character<=L'9') || (character>=L'a'&&character<=L'z') ||
        (character>=L'A'&&character<=L'Z') || character==L'.' || character==L'_' || character==L'-'))return false;
  return true;
}
/** 中文：仅接受系统目录 comctl32 或已验证的当前架构 WinSxS 系统程序集映像。 English: Accept only system-directory comctl32 or the verified current-architecture system WinSxS assembly image. 参数声明 / Declared parameters: const std::wstring& path. */
static bool controlSystemImage(const std::wstring& path) {
  wchar_t system[MAX_PATH]{};
  const UINT length=GetSystemDirectoryW(system,MAX_PATH);
  return (length && length<MAX_PATH && controlSystemEqual(path,std::wstring(system)+L"\\comctl32.dll")) ||
    controlSystemAssembly(path,false);
}
