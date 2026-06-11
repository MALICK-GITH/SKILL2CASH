/** Types canoniques exposés au client (Socket + API). */
export const NOTIFICATION_PUBLIC_TYPES = [
  'challenge_received',
  'challenge_accepted',
  'challenge_refused',
  'deposit_pending',
  'deposit_validated',
  'payment_sent',
  'ocr_started',
  'ocr_completed',
  'match_result_validated',
  'admin_alert',
  'system_alert'
];

const DOMAIN_TO_PUBLIC = {
  'challenge:new': 'challenge_received',
  'challenge:accepted': 'challenge_accepted',
  'challenge:declined': 'challenge_refused',
  'challenge:counter_offer': 'system_alert',
  'challenge:expired': 'system_alert',
  'challenge:cancelled': 'system_alert',
  'challenge:created': 'system_alert',
  'deposit:submitted': 'deposit_pending',
  'deposit:approved': 'deposit_validated',
  'deposit:rejected': 'system_alert',
  'deposit:ocr_processing': 'ocr_started',
  'deposit:ocr_matched': 'ocr_completed',
  'deposit:ocr_review_required': 'ocr_completed',
  'withdrawal:submitted': 'system_alert',
  'withdrawal:processing': 'system_alert',
  'withdrawal:review_required': 'system_alert',
  'withdrawal:approved': 'system_alert',
  'withdrawal:rejected': 'system_alert',
  'withdrawal:paid': 'payment_sent',
  'duel:payment_released': 'payment_sent',
  'duel:finished': 'match_result_validated',
  'duel:analysis_started': 'ocr_started',
  'duel:processing': 'ocr_completed',
  'duel:review_required': 'ocr_completed',
  'admin:deposit_pending': 'admin_alert',
  'admin:deposit_reviewed': 'admin_alert',
  'admin:withdrawal_pending': 'admin_alert',
  'admin:withdrawal_reviewed': 'admin_alert',
  'admin:dispute_pending': 'admin_alert',
  'admin:dispute_resolved': 'admin_alert',
  'admin:username_change_pending': 'admin_alert',
  'admin:new_user': 'admin_alert',
  'admin:challenge_created': 'admin_alert',
  'admin:challenge_cleanup': 'admin_alert',
  'admin:duel_room_created': 'admin_alert',
  'admin:duel_settled': 'admin_alert',
  'security:profile_suspicious': 'admin_alert',
  'security:withdrawal_suspicious': 'admin_alert'
};

export function mapDomainEventToPublicType(domainEvent) {
  if (!domainEvent) return 'system_alert';
  return DOMAIN_TO_PUBLIC[domainEvent] || 'system_alert';
}

const PRIORITY_BY_PUBLIC = {
  challenge_received: 'high',
  challenge_accepted: 'high',
  challenge_refused: 'medium',
  deposit_pending: 'high',
  deposit_validated: 'high',
  payment_sent: 'high',
  ocr_started: 'medium',
  ocr_completed: 'medium',
  match_result_validated: 'high',
  admin_alert: 'high',
  system_alert: 'low'
};

export function defaultPriorityForPublicType(publicType) {
  return PRIORITY_BY_PUBLIC[publicType] || 'medium';
}
