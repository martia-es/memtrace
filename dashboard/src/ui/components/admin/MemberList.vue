<script setup lang="ts">
import type { MembersResponseDto } from "@/application/identity-api";
import { ROLE_LABEL, formatDate, initials } from "../../composables/useAdminDirectory";

/** Miembros activos e invitaciones pendientes de un ámbito (organización o experimento). */
defineProps<{ data: MembersResponseDto | undefined }>();
</script>

<template>
  <div class="member-list">
    <ul v-if="data?.members.length" class="adm-list">
      <li v-for="m in data.members" :key="m.userId" class="adm-item">
        <div class="adm-avatar">{{ initials(m.name ?? m.email) }}</div>
        <div class="adm-item-main">
          <span class="adm-item-title">{{ m.name ?? m.email }}</span>
          <span class="adm-item-meta">{{ m.email }}</span>
        </div>
        <span class="adm-pill" :class="m.role">{{ ROLE_LABEL[m.role] }}</span>
      </li>
    </ul>
    <p v-else class="adm-hint">No active members yet.</p>

    <template v-if="data?.pendingInvitations.length">
      <h4 class="adm-section-title">Pending invitations</h4>
      <ul class="adm-list">
        <li v-for="inv in data.pendingInvitations" :key="inv.id" class="adm-item pending">
          <div class="adm-avatar pending">?</div>
          <div class="adm-item-main">
            <span class="adm-item-title">{{ inv.email }}</span>
            <span class="adm-item-meta">invited {{ formatDate(inv.createdAt) }} · waiting for them to sign in</span>
          </div>
          <span class="adm-pill outline" :class="inv.role">{{ ROLE_LABEL[inv.role] }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.member-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
