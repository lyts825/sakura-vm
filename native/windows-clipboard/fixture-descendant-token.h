#pragma once
#include "fixture-descendant.h"
#include "descendant-token.h"
#include <cstdio>
#include <memory>

constexpr wchar_t SakuraTokenLiteral[]=L"empty space 中文 \\ trailing\\ \"quoted\"";
inline bool tokenFixtureMode(const std::string& mode){return mode.rfind("as-user-",0)==0 || mode.rfind("with-token",0)==0 || mode=="with-logon";}
struct TokenFixtureHandles {
  HANDLE primary=nullptr,argument=nullptr,input=nullptr,output=nullptr,error=nullptr;
  bool impersonated=false;
  ~TokenFixtureHandles(){const DWORD saved=GetLastError();if(impersonated)RevertToSelf();for(HANDLE handle:{primary,argument,input,output,error})if(handle && handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);SetLastError(saved);}
};
struct TokenFixtureStandardHandles {
  HANDLE input=nullptr,output=nullptr,error=nullptr;
  ~TokenFixtureStandardHandles(){for(HANDLE handle:{input,output,error})if(handle)CloseHandle(handle);}
};
struct TokenFixtureEvidence {
  bool processInheritable=false,threadInheritable=false,sameUser=false;
  bool sourceObserved=false,sourceUnchanged=false;
  DWORD session=0,tokenType=0;
  uint64_t authentication=0,input=0,output=0,error=0;
  uint64_t sourceToken=0,sourceModifiedBefore=0,sourceModifiedAfter=0;
  std::shared_ptr<TokenFixtureStandardHandles> standard;
};
inline uint64_t tokenFixtureAuthentication(HANDLE process,DWORD& session,DWORD& type) {
  HANDLE token=nullptr;DWORD size=0;TOKEN_STATISTICS statistics{};
  if(!OpenProcessToken(process,TOKEN_QUERY,&token))return 0;
  const bool good=GetTokenInformation(token,TokenStatistics,&statistics,sizeof(statistics),&size) && GetTokenInformation(token,TokenSessionId,&session,sizeof(session),&size);
  CloseHandle(token);if(!good)return 0;type=DWORD(statistics.TokenType);
  return (uint64_t(DWORD(statistics.AuthenticationId.HighPart))<<32)|statistics.AuthenticationId.LowPart;
}
inline bool tokenFixtureSameUser(HANDLE left,HANDLE right) {
  HANDLE first=nullptr,second=nullptr;DWORD one=0,two=0;bool same=false;
  if(OpenProcessToken(left,TOKEN_QUERY,&first) && OpenProcessToken(right,TOKEN_QUERY,&second)){
    GetTokenInformation(first,TokenUser,nullptr,0,&one);GetTokenInformation(second,TokenUser,nullptr,0,&two);
    if(one && two){std::vector<unsigned char> a(one),b(two);if(GetTokenInformation(first,TokenUser,a.data(),one,&one) && GetTokenInformation(second,TokenUser,b.data(),two,&two))same=EqualSid(reinterpret_cast<TOKEN_USER*>(a.data())->User.Sid,reinterpret_cast<TOKEN_USER*>(b.data())->User.Sid)!=FALSE;}
  }
  if(first)CloseHandle(first);if(second)CloseHandle(second);return same;
}
inline std::string tokenFixtureSourceCheck() {
  TokenFixtureHandles owned;
  if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY|TOKEN_DUPLICATE,&owned.primary) ||
      !DuplicateTokenEx(owned.primary,TOKEN_ALL_ACCESS,nullptr,SecurityImpersonation,TokenPrimary,&owned.argument))throw std::runtime_error("fixture source token unavailable");
  DescendantToken inspected(owned.argument,false);
  TOKEN_STATISTICS before{},changed{},restored{};DWORD size=0;
  if(!GetTokenInformation(inspected.argument(),TokenStatistics,&before,sizeof(before),&size))throw std::runtime_error("fixture source statistics unavailable");
  // The hook pins the caller's original kernel object without changing its
  // access. Reuse of the caller's closed handle must not select the new Event.
  CloseHandle(owned.argument);owned.argument=CreateEventW(nullptr,TRUE,FALSE,nullptr);
  inspected.verifySource();
  GetTokenInformation(inspected.argument(),TokenPrivileges,nullptr,0,&size);std::vector<unsigned char> privileges(size);
  if(!size || !GetTokenInformation(inspected.argument(),TokenPrivileges,privileges.data(),size,&size))throw std::runtime_error("fixture source privileges unavailable");
  LUID notify{};if(!LookupPrivilegeValueW(nullptr,SE_CHANGE_NOTIFY_NAME,&notify))throw std::runtime_error("fixture privilege identity unavailable");
  bool found=false,enabled=false;const auto list=reinterpret_cast<TOKEN_PRIVILEGES*>(privileges.data());
  for(DWORD index=0;index<list->PrivilegeCount;++index)if(descendantTokenLuid(list->Privileges[index].Luid,notify)){found=true;enabled=(list->Privileges[index].Attributes&SE_PRIVILEGE_ENABLED)!=0;}
  if(!found)throw std::runtime_error("fixture source lacks traversal privilege");
  TOKEN_PRIVILEGES update{},previous{};update.PrivilegeCount=1;update.Privileges[0]={notify,enabled?0u:DWORD(SE_PRIVILEGE_ENABLED)};
  if(!AdjustTokenPrivileges(inspected.argument(),FALSE,&update,sizeof(previous),&previous,&size) || GetLastError()!=ERROR_SUCCESS ||
      !GetTokenInformation(inspected.argument(),TokenStatistics,&changed,sizeof(changed),&size))throw std::runtime_error("fixture source mutation unavailable");
  const auto rejected=[](const auto& call){try{call();return false;}catch(...){return true;}};
  const bool beforeCallRejected=rejected([&]{inspected.verifySource();});
  const bool childCheckRejected=rejected([&]{inspected.verifyChild(GetCurrentProcess());});
  if(!AdjustTokenPrivileges(inspected.argument(),FALSE,&previous,0,nullptr,nullptr) || GetLastError()!=ERROR_SUCCESS ||
      !GetTokenInformation(inspected.argument(),TokenStatistics,&restored,sizeof(restored),&size))throw std::runtime_error("fixture source restore unavailable");
  const bool restoredSnapshotRejected=rejected([&]{inspected.verifySource();});
  DescendantToken implicit(nullptr,true);
  owned.impersonated=ImpersonateSelf(SecurityImpersonation)!=FALSE;
  if(!owned.impersonated)throw std::runtime_error("fixture implicit impersonation unavailable");
  const bool implicitChangedRejected=rejected([&]{implicit.verifySource();});
  if(!RevertToSelf())throw std::runtime_error("fixture implicit impersonation restore failed");owned.impersonated=false;
  const auto luid=[](const LUID& value){return (uint64_t(DWORD(value.HighPart))<<32)|value.LowPart;};
  char answer[1024]{};
  std::snprintf(answer,sizeof(answer),"{\"sourceHandleClosedStillPinned\":true,\"beforeCallRejected\":%s,\"childCheckRejected\":%s,\"restoredSnapshotRejected\":%s,\"implicitChangedRejected\":%s,\"tokenId\":\"%llu\",\"modifiedBefore\":\"%llu\",\"modifiedChanged\":\"%llu\",\"modifiedRestored\":\"%llu\"}\n",beforeCallRejected?"true":"false",childCheckRejected?"true":"false",restoredSnapshotRejected?"true":"false",implicitChangedRejected?"true":"false",static_cast<unsigned long long>(luid(before.TokenId)),static_cast<unsigned long long>(luid(before.ModifiedId)),static_cast<unsigned long long>(luid(changed.ModifiedId)),static_cast<unsigned long long>(luid(restored.ModifiedId)));
  return answer;
}
inline BOOL tokenFixtureCreate(const std::string& mode,const std::wstring& image,std::wstring& command,const std::wstring& desktop,
    const std::wstring& directory,bool semantics,PROCESS_INFORMATION& child,TokenFixtureEvidence& evidence) {
  TokenFixtureHandles owned;
  if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY|TOKEN_DUPLICATE|TOKEN_ASSIGN_PRIMARY,&owned.primary))return FALSE;
  HANDLE token=owned.primary;
  if(mode=="as-user-null" || mode=="as-user-null-impersonated" || mode=="as-user-null-anonymous")token=nullptr;
  if(mode=="as-user-invalid" || mode=="with-token-invalid"){owned.argument=CreateEventW(nullptr,TRUE,FALSE,nullptr);token=owned.argument;}
  if(mode=="as-user-no-query" || mode=="with-token-no-query"){
    if(!DuplicateHandle(GetCurrentProcess(),owned.primary,GetCurrentProcess(),&owned.argument,TOKEN_ASSIGN_PRIMARY,FALSE,0))return FALSE;token=owned.argument;
  }
  if(mode=="as-user-impersonation"){
    if(!DuplicateTokenEx(owned.primary,TOKEN_ALL_ACCESS,nullptr,SecurityImpersonation,TokenImpersonation,&owned.argument))return FALSE;token=owned.argument;
  }
  if(mode=="as-user-restricted"){
    if(!CreateRestrictedToken(owned.primary,DISABLE_MAX_PRIVILEGE,0,nullptr,0,nullptr,0,nullptr,&owned.argument))return FALSE;token=owned.argument;
  }
  if(mode=="as-user-null-impersonated" || mode=="as-user-null-anonymous"){
    owned.impersonated=mode=="as-user-null-anonymous"?ImpersonateAnonymousToken(GetCurrentThread())!=FALSE:ImpersonateSelf(SecurityImpersonation)!=FALSE;
    if(!owned.impersonated)return FALSE;
  }
  STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.lpDesktop=const_cast<wchar_t*>(desktop.c_str());
  DWORD flags=CREATE_NO_WINDOW|(mode=="as-user-suspended"?CREATE_SUSPENDED:0);
  SECURITY_ATTRIBUTES security{sizeof(security),nullptr,TRUE};
  std::wstring environment;
  if(semantics){
    SECURITY_ATTRIBUTES inherited{sizeof(inherited),nullptr,TRUE};
    owned.input=CreateEventW(&inherited,TRUE,FALSE,nullptr);owned.output=CreateEventW(&inherited,TRUE,FALSE,nullptr);owned.error=CreateEventW(&inherited,TRUE,FALSE,nullptr);
    if(!owned.input || !owned.output || !owned.error)return FALSE;
    startup.dwFlags=STARTF_USESTDHANDLES;startup.hStdInput=owned.input;startup.hStdOutput=owned.output;startup.hStdError=owned.error;
    evidence.input=uint64_t(uintptr_t(owned.input));evidence.output=uint64_t(uintptr_t(owned.output));evidence.error=uint64_t(uintptr_t(owned.error));
    environment=L"SAKURA_TOKEN_LITERAL="+std::wstring(SakuraTokenLiteral);environment.push_back(L'\0');
    wchar_t system[32768]{};const DWORD size=GetEnvironmentVariableW(L"SystemRoot",system,32768);
    if(!size || size>=32768){SetLastError(ERROR_INVALID_ENVIRONMENT);return FALSE;}
    environment+=L"SystemRoot="+std::wstring(system,size);environment.push_back(L'\0');environment.push_back(L'\0');flags|=CREATE_UNICODE_ENVIRONMENT;
  }
  BOOL created=FALSE;
  const auto luid=[](const LUID& value){return (uint64_t(DWORD(value.HighPart))<<32)|value.LowPart;};
  TOKEN_STATISTICS before{},after{};DWORD statisticsSize=0;
  const HANDLE source=token?token:owned.primary;
  const BOOL inspected=GetTokenInformation(source,TokenStatistics,&before,sizeof(before),&statisticsSize);
  if(mode=="as-user-A"){
    const auto ansi=[](const std::wstring& value){const int size=WideCharToMultiByte(CP_ACP,0,value.c_str(),-1,nullptr,0,nullptr,nullptr);std::string text(size,'\0');if(size)WideCharToMultiByte(CP_ACP,0,value.c_str(),-1,text.data(),size,nullptr,nullptr);return text;};
    const auto path=ansi(image),work=ansi(directory),desk=ansi(desktop);auto arguments=ansi(command);
    STARTUPINFOA info{};info.cb=sizeof(info);info.lpDesktop=const_cast<char*>(desk.c_str());info.dwFlags=startup.dwFlags;info.hStdInput=startup.hStdInput;info.hStdOutput=startup.hStdOutput;info.hStdError=startup.hStdError;
    created=CreateProcessAsUserA(token,path.c_str(),arguments.data(),semantics?&security:nullptr,semantics?&security:nullptr,semantics,flags,semantics?environment.data():nullptr,directory.empty()?nullptr:work.c_str(),&info,&child);
  }else if(mode=="as-user-extended"){
    STARTUPINFOEXW info{};info.StartupInfo=startup;info.StartupInfo.cb=sizeof(info);
    created=CreateProcessAsUserW(token,image.c_str(),command.data(),nullptr,nullptr,FALSE,flags|EXTENDED_STARTUPINFO_PRESENT,nullptr,nullptr,&info.StartupInfo,&child);
  }else if(mode.rfind("with-token",0)==0){
    created=CreateProcessWithTokenW(token,0,image.c_str(),command.data(),flags,semantics?environment.data():nullptr,directory.empty()?nullptr:directory.c_str(),&startup,&child);
  }else if(mode=="with-logon"){
    created=CreateProcessWithLogonW(L"SakuraClipboardFixture",L".",L"unused-test-credentials",LOGON_NETCREDENTIALS_ONLY,image.c_str(),command.data(),flags,semantics?environment.data():nullptr,directory.empty()?nullptr:directory.c_str(),&startup,&child);
  }else {
    created=CreateProcessAsUserW(token,mode=="as-user-implicit"?nullptr:image.c_str(),command.data(),semantics?&security:nullptr,semantics?&security:nullptr,semantics,flags,semantics?environment.data():nullptr,directory.empty()?nullptr:directory.c_str(),&startup,&child);
  }
  const DWORD saved=created?0:GetLastError();
  if(inspected && GetTokenInformation(source,TokenStatistics,&after,sizeof(after),&statisticsSize)){
    evidence.sourceObserved=true;evidence.sourceToken=luid(before.TokenId);
    evidence.sourceModifiedBefore=luid(before.ModifiedId);evidence.sourceModifiedAfter=luid(after.ModifiedId);
    evidence.sourceUnchanged=luid(before.TokenId)==luid(after.TokenId) && luid(before.ModifiedId)==luid(after.ModifiedId) && luid(before.AuthenticationId)==luid(after.AuthenticationId) && before.TokenType==after.TokenType;
  }
  if(created){DWORD bits=0;evidence.processInheritable=GetHandleInformation(child.hProcess,&bits) && (bits&HANDLE_FLAG_INHERIT);bits=0;evidence.threadInheritable=GetHandleInformation(child.hThread,&bits) && (bits&HANDLE_FLAG_INHERIT);evidence.authentication=tokenFixtureAuthentication(child.hProcess,evidence.session,evidence.tokenType);evidence.sameUser=tokenFixtureSameUser(child.hProcess,GetCurrentProcess());}
  if(created && semantics){
    evidence.standard=std::make_shared<TokenFixtureStandardHandles>();
    evidence.standard->input=owned.input;evidence.standard->output=owned.output;evidence.standard->error=owned.error;
    owned.input=nullptr;owned.output=nullptr;owned.error=nullptr;
  }
  SetLastError(saved);return created;
}
