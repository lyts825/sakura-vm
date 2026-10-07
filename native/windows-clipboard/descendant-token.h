/**
 * 模块职责（中文）：固定调用者原 token 内核对象与统计快照，核对 SID、session、primary 类型及 Authentication/Modified LUID，拒绝源变化或线程模拟，防止句柄关闭/重用替换授权身份。
 * Module responsibilities (English): Pin the caller's original token kernel object/statistics snapshot, verify SID/session/primary type/Authentication and Modified LUIDs, reject source change/impersonation and prevent authorization replacement by handle close/reuse.
 */
/** 后代令牌检查与固定：核实 SID、认证 LUID、会话和 primary 类型，限制 CreateProcessAsUser、WithToken、WithLogon 的身份边界。 */
#pragma once
#include "protocol.h"
#include <cstring>
#include <stdexcept>
#include <vector>
#include <utility>

struct DescendantTokenHandle {
  HANDLE value=nullptr;
  /** 中文：关闭固定 token 句柄，保持 token 查询对象活到所有身份核验完成。 English: Close the pinned token handle after its identity-validation lifetime ends. */
  ~DescendantTokenHandle(){const DWORD error=GetLastError();if(value && value!=INVALID_HANDLE_VALUE)CloseHandle(value);SetLastError(error);}
  /** 中文：保留此资源持有类型的默认构造，成员使用声明处的空句柄/空缓冲区初值，尚未取得需要释放的资源。 English: Retain the resource holder's default constructor, using null handle/buffer member initializers without acquiring a resource to release yet. */
  DescendantTokenHandle()=default;
  /** 中文：删除此类型的复制构造，避免裸句柄或自有缓冲区被多个对象重复释放；传入对象不能通过此声明复制。 English: Delete this type's copy constructor to prevent multiple objects releasing the same raw handle/owned buffer; the supplied object cannot be copied through this declaration. 参数声明 / Declared parameters: const DescendantTokenHandle&. */
  DescendantTokenHandle(const DescendantTokenHandle&)=delete;
};
/** 中文：逐半部比较 LUID，不把认证、令牌或修改代次缩成截断整数。 English: Compare both LUID halves without truncating authentication/token/modification identity. 参数声明 / Declared parameters: const LUID& left,const LUID& right. */
inline bool descendantTokenLuid(const LUID& left,const LUID& right) {
  return left.LowPart==right.LowPart && left.HighPart==right.HighPart;
}
struct DescendantTokenIdentity {
  std::vector<unsigned char> sid;
  DWORD session;
  TOKEN_STATISTICS statistics;
};
/** 中文：对已复制稳定 SID 做 Windows SID 等值判断。 English: Compare independently copied stable SIDs with Windows SID equality. 参数声明 / Declared parameters: const DescendantTokenIdentity& left,const DescendantTokenIdentity& right. */
inline bool descendantTokenSameSid(const DescendantTokenIdentity& left,const DescendantTokenIdentity& right) {
  return EqualSid(const_cast<unsigned char*>(left.sid.data()),const_cast<unsigned char*>(right.sid.data()))!=FALSE;
}
// Token IDs and modification IDs bracket each SID/session read. The same held
// object is checked immediately before the system call and around inspection
// of the actual child, which remains suspended in its creation-time Job.
/** 中文：以 TokenId、ModifiedId、AuthenticationId 和类型前后包围 SID/会话读取，最多八次重试；变化或读取失败拒绝，返回独立 SID 副本。 English: Bracket SID/session reads with TokenId/ModifiedId/AuthenticationId/type, retry at most eight times and reject changes/read failures while returning a copied SID. 参数声明 / Declared parameters: HANDLE token. */
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
/** 中文：从精确进程打开查询令牌并读取稳定身份，临时句柄由 RAII 关闭。 English: Open the exact process token for stable identity inspection and close the temporary handle through RAII. 参数声明 / Declared parameters: HANDLE process. */
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
  /** 中文：复制调用者指定的同一令牌内核对象；隐式令牌仅在线程没有 impersonation 时固定进程 primary token。要求同用户、同会话、primary 类型，调用前后仍复核。 English: Duplicate the caller's same token kernel object; for implicit tokens pin the process primary token only without thread impersonation. Require same user/session/primary type and reverify around creation. 参数声明 / Declared parameters: HANDLE token,bool allowNull. */
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
  /** 中文：显式令牌返回固定副本，隐式模式仍返回 null 保留原 Windows API 语义，不以替代句柄改变调用行为。 English: Return the pinned duplicate for explicit tokens but retain null in implicit mode, preserving original Windows API semantics rather than substituting a handle. */
  HANDLE argument() const {return supplied?pinned.value:nullptr;}
  /** 中文：核对固定令牌的全部身份与修改代次，隐式模式还确认当前线程未转 impersonation且当前进程 token 未换，变化即拒绝创建。 English: Verify the pinned token's identity/modification generation; implicit mode also checks no new impersonation/current-process-token replacement, rejecting creation on change. */
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
  /** 中文：在实际子令牌检查前后复核源令牌，并确认子 primary 类型、SID、会话和认证 LUID一致；调用方在核验期间仍保持创建时的线程挂起。 English: Reverify the source before/after actual child-token inspection and require matching primary type/SID/session/authentication LUID while callers retain the creation-time thread suspension during validation. 参数声明 / Declared parameters: HANDLE process. */
  void verifyChild(HANDLE process) const {
    verifySource();
    const auto actual=descendantProcessToken(process);DWORD session=0;
    if(actual.statistics.TokenType!=TokenPrimary || actual.session!=expected.session ||
        !ProcessIdToSessionId(GetProcessId(process),&session) || session!=expected.session ||
        !descendantTokenLuid(actual.statistics.AuthenticationId,expected.statistics.AuthenticationId) ||
        !descendantTokenSameSid(actual,expected))throw std::runtime_error("created child token differs from the inspected token");
    verifySource();
  }
  /** 中文：删除此类型的复制构造，避免裸句柄或自有缓冲区被多个对象重复释放；传入对象不能通过此声明复制。 English: Delete this type's copy constructor to prevent multiple objects releasing the same raw handle/owned buffer; the supplied object cannot be copied through this declaration. 参数声明 / Declared parameters: const DescendantToken&. */
  DescendantToken(const DescendantToken&)=delete;
};
