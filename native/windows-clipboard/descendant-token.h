#pragma once
#include "protocol.h"
#include <cstring>
#include <stdexcept>
#include <vector>
#include <utility>

struct DescendantTokenHandle {
  HANDLE value=nullptr;
  ~DescendantTokenHandle(){const DWORD error=GetLastError();if(value && value!=INVALID_HANDLE_VALUE)CloseHandle(value);SetLastError(error);}
  DescendantTokenHandle()=default;
  DescendantTokenHandle(const DescendantTokenHandle&)=delete;
};
inline bool descendantTokenLuid(const LUID& left,const LUID& right) {
  return left.LowPart==right.LowPart && left.HighPart==right.HighPart;
}
struct DescendantTokenIdentity {
  std::vector<unsigned char> sid;
  DWORD session;
  TOKEN_STATISTICS statistics;
};
inline bool descendantTokenSameSid(const DescendantTokenIdentity& left,const DescendantTokenIdentity& right) {
  return EqualSid(const_cast<unsigned char*>(left.sid.data()),const_cast<unsigned char*>(right.sid.data()))!=FALSE;
}
// Token IDs and modification IDs bracket each SID/session read. The same held
// object is checked immediately before the system call and around inspection
// of the actual child, which remains suspended in its creation-time Job.
inline DescendantTokenIdentity descendantTokenIdentity(HANDLE token) {
  for(unsigned attempt=0;attempt<8;++attempt){
    TOKEN_STATISTICS before{},after{};DWORD size=0,session=0;
    if(!GetTokenInformation(token,TokenStatistics,&before,sizeof(before),&size))throw std::runtime_error("child token statistics unavailable");
    GetTokenInformation(token,TokenUser,nullptr,0,&size);
    if(!size || size>65536)throw std::runtime_error("child token user unavailable");
    std::vector<unsigned char> user(size);
    if(!GetTokenInformation(token,TokenUser,user.data(),size,&size))throw std::runtime_error("child token user unavailable");
    const auto sid=reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid;
    if(!IsValidSid(sid))throw std::runtime_error("child token user differs");
    std::vector<unsigned char> copied(GetLengthSid(sid));
    if(!CopySid(DWORD(copied.size()),copied.data(),sid) ||
        !GetTokenInformation(token,TokenSessionId,&session,sizeof(session),&size) ||
        !GetTokenInformation(token,TokenStatistics,&after,sizeof(after),&size))throw std::runtime_error("child token identity unavailable");
    if(descendantTokenLuid(before.TokenId,after.TokenId) &&
        descendantTokenLuid(before.ModifiedId,after.ModifiedId) &&
        descendantTokenLuid(before.AuthenticationId,after.AuthenticationId) && before.TokenType==after.TokenType)
      return {std::move(copied),session,after};
  }
  throw std::runtime_error("child token changed during inspection");
}
inline DescendantTokenIdentity descendantProcessToken(HANDLE process) {
  DescendantTokenHandle token;
  if(!OpenProcessToken(process,TOKEN_QUERY,&token.value))throw std::runtime_error("child process token unavailable");
  return descendantTokenIdentity(token.value);
}
class DescendantToken {
  DescendantTokenHandle pinned;
  DescendantTokenIdentity expected;
  bool supplied;
public:
  explicit DescendantToken(HANDLE token,bool allowNull):supplied(token!=nullptr) {
    if(token){
      // Duplicate the same kernel object and access mask, not a replacement
      // token. Another thread closing/reusing the caller's handle cannot change
      // the identity passed to the original system API.
      if(!DuplicateHandle(GetCurrentProcess(),token,GetCurrentProcess(),&pinned.value,0,FALSE,DUPLICATE_SAME_ACCESS))
        throw std::runtime_error("child token handle unavailable");
    }else{
      if(!allowNull)throw std::runtime_error("child token unavailable");
      DescendantTokenHandle impersonation;
      if(OpenThreadToken(GetCurrentThread(),TOKEN_QUERY,TRUE,&impersonation.value) || GetLastError()!=ERROR_NO_TOKEN)
        throw std::runtime_error("implicit child token under impersonation is not verifiable");
      if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&pinned.value))throw std::runtime_error("implicit child token unavailable");
    }
    expected=descendantTokenIdentity(pinned.value);
    const auto caller=descendantProcessToken(GetCurrentProcess());DWORD session=0;
    if(expected.statistics.TokenType!=TokenPrimary || caller.statistics.TokenType!=TokenPrimary ||
        !ProcessIdToSessionId(GetCurrentProcessId(),&session) || caller.session!=session || expected.session!=session ||
        !descendantTokenSameSid(expected,caller))throw std::runtime_error("child token user, type or session differs");
  }
  HANDLE argument() const {return supplied?pinned.value:nullptr;}
  void verifySource() const {
    const auto actual=descendantTokenIdentity(pinned.value);
    if(!descendantTokenLuid(actual.statistics.TokenId,expected.statistics.TokenId) ||
        !descendantTokenLuid(actual.statistics.ModifiedId,expected.statistics.ModifiedId) ||
        !descendantTokenLuid(actual.statistics.AuthenticationId,expected.statistics.AuthenticationId) ||
        actual.statistics.TokenType!=expected.statistics.TokenType || actual.session!=expected.session ||
        !descendantTokenSameSid(actual,expected))throw std::runtime_error("source token changed during controlled creation");
    if(!supplied){
      DescendantTokenHandle impersonation;
      if(OpenThreadToken(GetCurrentThread(),TOKEN_QUERY,TRUE,&impersonation.value) || GetLastError()!=ERROR_NO_TOKEN)
        throw std::runtime_error("implicit child token changed to impersonation");
      const auto primary=descendantProcessToken(GetCurrentProcess());
      if(!descendantTokenLuid(primary.statistics.TokenId,expected.statistics.TokenId) ||
          !descendantTokenLuid(primary.statistics.ModifiedId,expected.statistics.ModifiedId) ||
          !descendantTokenLuid(primary.statistics.AuthenticationId,expected.statistics.AuthenticationId) ||
          primary.statistics.TokenType!=expected.statistics.TokenType || primary.session!=expected.session ||
          !descendantTokenSameSid(primary,expected))throw std::runtime_error("implicit source token changed during controlled creation");
    }
  }
  void verifyChild(HANDLE process) const {
    verifySource();
    const auto actual=descendantProcessToken(process);DWORD session=0;
    if(actual.statistics.TokenType!=TokenPrimary || actual.session!=expected.session ||
        !ProcessIdToSessionId(GetProcessId(process),&session) || session!=expected.session ||
        !descendantTokenLuid(actual.statistics.AuthenticationId,expected.statistics.AuthenticationId) ||
        !descendantTokenSameSid(actual,expected))throw std::runtime_error("created child token differs from the inspected token");
    verifySource();
  }
  DescendantToken(const DescendantToken&)=delete;
};
