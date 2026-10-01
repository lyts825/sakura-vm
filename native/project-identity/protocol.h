#ifndef SAKURA_PROJECT_IDENTITY_PROTOCOL_H
#define SAKURA_PROJECT_IDENTITY_PROTOCOL_H
#include <stdint.h>

/* These records are little-endian, fixed size, root-owned and replaced atomically.
 * JSON is an administrative view, never an input to the privileged launcher. */
#define SK_ID_BASE "/var/lib/sakura/project-identities"
#define SK_ID_RUNTIME "/run/sakura-project-identities"
#define SK_ID_HOMES "/var/lib/sakura-project-homes"
#define SK_ID_BUILDS "/usr/local/lib/sakura-project-identity"
#define SK_ID_VERSION 1u
#define SK_ID_INTENT 1u
#define SK_ID_ACTIVE 2u
#define SK_RUN_ACTIVE 1u
#define SK_RUN_CLOSED 2u
#define SK_RUN_INDEPENDENT 1u
#define SK_RUN_INHERIT 2u
#define SK_NETWORK_HOST 0u
#define SK_NETWORK_PRIVATE 1u
#define SK_NETWORK_PENDING 1u
#define SK_NETWORK_DELETING 2u
#define SK_NETWORK_RELEASED 3u
#define SK_PAYLOAD_VERSION 1u
#define SK_PAYLOAD_LIMIT 131072u
#define SK_PAYLOAD_TEXT_LIMIT 65536u
#define SK_PAYLOAD_ENV_LIMIT 128u
#define SK_PAYLOAD_ENTRY_LIMIT 8192u
#define SK_PAYLOAD_TIMEOUT_MS 8000

#pragma pack(push, 1)
struct sk_binding {
    char magic[8];
    uint32_t version, flags, uid, gid;
    uint64_t revision, directory_device, directory_inode, home_device, home_inode;
    char registry[37], project[17], account[32], identity[37], home[256], directory[1024];
    uint32_t network;
    unsigned char reserved[577];
};
struct sk_run {
    char magic[8];
    uint32_t version, flags, mode, reserved_word;
    uint64_t revision, network_device, network_inode, cgroup_device, cgroup_inode;
    char registry[37], identity[37], project[17], run[37], boot[37], build[65];
    char cgroup[64], namespace_name[32];
    unsigned char reserved[634];
};
struct sk_uid_map {
    char magic[8];
    uint32_t version, uid;
    char registry[37], project[17], identity[37];
    unsigned char reserved[149];
};
struct sk_registry {
    char magic[8];
    uint32_t version;
    char registry[37];
    unsigned char reserved[207];
};
/* One root-owned release authority per project. Pending/deleting blocks new
 * launches under the same flock; released retains its exact nonce/epoch. */
struct sk_network_guard {
    char magic[8];
    uint32_t version, flags;
    uint64_t revision, network_device, network_inode;
    char registry[37], identity[37], project[17], boot[37], generation[37], release[37];
    unsigned char reserved[14];
};
/* Transient stdin frame only: never written to the authority directories.
 * Body: UTF-8 script, then {key_size,value_size,key,value} environment entries.
 * Every integer is little endian, followed by an exact EOF on the channel. */
struct sk_payload_header {
    char magic[8];
    uint32_t version, flags, body_size, environment_count, script_size, reserved;
};
#pragma pack(pop)
_Static_assert(sizeof(struct sk_binding) == 2048, "binding ABI");
_Static_assert(sizeof(struct sk_run) == 1024, "run ABI");
_Static_assert(sizeof(struct sk_uid_map) == 256, "uid map ABI");
_Static_assert(sizeof(struct sk_registry) == 256, "registry ABI");
_Static_assert(sizeof(struct sk_network_guard) == 256, "network guard ABI");
_Static_assert(sizeof(struct sk_payload_header) == 32, "payload ABI");
#endif
