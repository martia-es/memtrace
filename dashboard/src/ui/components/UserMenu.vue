<script setup lang="ts">
import { computed } from "vue";
import { useAsync } from "../composables/useAsync";
import { useIdentityApi } from "../composables/useIdentityApi";
// signOut import removed (next-auth/react is React‑only and not usable in Vue)

defineProps<{ collapsed: boolean }>();

const identityApi = useIdentityApi();
const me = useAsync((signal) => identityApi.getMe(signal));
void me.run();

const handleSignOut = async () => {
  try {
    const csrfRes = await fetch("/api/auth/csrf", { credentials: "include" });
    const { csrfToken } = await csrfRes.json();
    await fetch("/api/auth/signout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: "/login" })
    });
  } catch (e) {
    console.warn("Logout request failed:", e);
  } finally {
    // Force a full page reload to clear any client‑side state
    window.location.href = "/login";
  }
};

const initials = computed(() => {
  const source = me.data.value?.name ?? me.data.value?.email ?? "";
  return source.trim().charAt(0).toUpperCase() || "?";
});
</script>

<template>
  <div v-if="me.data.value" class="user-menu" :class="{ collapsed }">
    <button type="button" class="user-trigger" :title="collapsed ? (me.data.value.name ?? me.data.value.email) : undefined">
      <span class="avatar avatar-fallback">{{ initials }}</span>
      <span v-if="!collapsed" class="user-info">
        <span class="user-name">{{ me.data.value.name ?? me.data.value.email }}</span>
        <span class="user-email">{{ me.data.value.email }}</span>
      </span>
      <q-menu auto-close anchor="top left" self="bottom left" :offset="[0, 8]" class="user-menu-popover">
        <div class="menu-header">
          <span class="avatar avatar-fallback">{{ initials }}</span>
          <span class="menu-header-info">
            <span class="user-name">{{ me.data.value.name ?? me.data.value.email }}</span>
            <span class="user-email">{{ me.data.value.email }}</span>
          </span>
        </div>
        <div class="menu-divider" />
        <button type="button" class="menu-action" @click="handleSignOut">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
          </svg>
          Sign out
        </button>
      </q-menu>
    </button>
  </div>
</template>

<style scoped>
.user-menu {
  margin-top: auto;
}
.user-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px;
  border: none;
  background: transparent;
  border-radius: 14px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  transition: background 0.2s ease;
}
.user-trigger:hover {
  background: var(--mt-soft);
}
.collapsed .user-trigger {
  justify-content: center;
  padding: 8px 0;
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}
.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font-size: 13px;
  font-weight: 700;
}
.user-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--mt-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-email {
  font-size: 11px;
  color: var(--mt-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

<style>
.user-menu-popover {
  border-radius: 18px;
  box-shadow: var(--mt-shadow), 0 0 0 1px var(--mt-line);
  overflow: hidden;
}
.user-menu-popover .menu-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  min-width: 220px;
}
.user-menu-popover .menu-header .avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.user-menu-popover .menu-header .avatar-fallback {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font-size: 14px;
  font-weight: 700;
}
.user-menu-popover .menu-header-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}
.user-menu-popover .user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--mt-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-menu-popover .user-email {
  font-size: 11.5px;
  color: var(--mt-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-menu-popover .menu-divider {
  height: 1px;
  background: var(--mt-line);
  margin: 0 0 6px;
}
.user-menu-popover .menu-action {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  margin: 0 0 6px;
  border: none;
  background: transparent;
  color: var(--mt-err-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}
.user-menu-popover .menu-action:hover {
  background: var(--mt-err-bg);
}
</style>
