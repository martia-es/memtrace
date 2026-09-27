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
      <img v-if="me.data.value.image" :src="me.data.value.image" :alt="me.data.value.name ?? me.data.value.email" class="avatar" referrerpolicy="no-referrer" />
      <span v-else class="avatar avatar-fallback">{{ initials }}</span>
      <span v-if="!collapsed" class="user-info">
        <span class="user-name">{{ me.data.value.name ?? me.data.value.email }}</span>
        <span class="user-email">{{ me.data.value.email }}</span>
      </span>
      <q-menu auto-close anchor="top left" self="bottom left" :offset="[0, 6]">
        <q-list dense style="min-width: 180px">
          <q-item clickable @click="handleSignOut">
            <q-item-section>Sign out</q-item-section>
          </q-item>
        </q-list>
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
