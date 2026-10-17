<script setup lang="ts">
import type { MembersResponseDto } from "@/application/identity-api";
import { ROLE_LABEL, formatDate, initials, roleTone } from "../../composables/useAdminDirectory";
import Pill from "../Pill.vue";
import { t } from "../../i18n";

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
        <Pill outline v-if="m.source !== 'manual'" :title="t('memberList.managed_by_your_identity_provider_source', { source: m.source === 'scim' ? 'SCIM' : t('memberList.sign_in_groups') })" data-testid="idp-badge">{{ t("memberList.idp") }}</Pill>
        <Pill :tone="roleTone(m.role)">{{ ROLE_LABEL[m.role] }}</Pill>
      </li>
    </ul>
    <p v-else class="adm-hint">{{ t("memberList.no_active_members_yet") }}</p>

    <template v-if="data?.pendingInvitations.length">
      <h4 class="adm-section-title">{{ t("memberList.pending_invitations") }}</h4>
      <ul class="adm-list">
        <li v-for="inv in data.pendingInvitations" :key="inv.id" class="adm-item pending">
          <div class="adm-avatar pending">?</div>
          <div class="adm-item-main">
            <span class="adm-item-title">{{ inv.email }}</span>
            <span class="adm-item-meta">{{ t("memberList.invited_when_waiting_for_them_to", { when: formatDate(inv.createdAt) }) }}</span>
          </div>
          <Pill outline :tone="roleTone(inv.role)">{{ ROLE_LABEL[inv.role] }}</Pill>
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
