#pragma once
#include <windows.h>
#include <string>

// comctl32 is not a KnownDLL on every supported Windows release. Permit only
// the OS system image or Windows' protected, architecture-matched Common
// Controls assembly, never an application/private assembly with the same name.
static bool controlSystemEqual(const std::wstring& first,const std::wstring& second) {
  return CompareStringOrdinal(first.c_str(),-1,second.c_str(),-1,TRUE)==CSTR_EQUAL;
}
static bool controlSystemPrefix(const std::wstring& value,const std::wstring& prefix) {
  return value.size()>=prefix.size() && CompareStringOrdinal(value.data(),int(prefix.size()),prefix.data(),int(prefix.size()),TRUE)==CSTR_EQUAL;
}
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
static bool controlSystemImage(const std::wstring& path) {
  wchar_t system[MAX_PATH]{};
  const UINT length=GetSystemDirectoryW(system,MAX_PATH);
  return (length && length<MAX_PATH && controlSystemEqual(path,std::wstring(system)+L"\\comctl32.dll")) ||
    controlSystemAssembly(path,false);
}
