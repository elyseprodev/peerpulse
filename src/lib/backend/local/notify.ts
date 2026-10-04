import { persist, uid, type LocalDatabase } from './db'
import type { AppNotification, NotificationType } from '@shared/domain'
import type { NotificationDraft } from '@shared/notify'

export interface NotificationInput {
  uid: string
  type: NotificationType
  title: string
  body: string
  link?: string | null
  priority?: AppNotification['priority']
}

/**
 * Queue a member notification. In Firebase mode this is the job of the
 * `notify` Cloud Function trigger; the local backend emulates it so the bell
 * menu behaves identically in both modes.
 */
export function pushNotification(db: LocalDatabase, input: NotificationInput): AppNotification {
  const id = uid('ntf')
  const notification: AppNotification = {
    id,
    uid: input.uid,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link ?? null,
    read: false,
    priority: input.priority ?? 'normal',
    createdAt: new Date().toISOString(),
  }
  db.notifications[id] = notification
  persist(`notifications|${input.uid}`)
  return notification
}

/**
 * The wording, recipient and type of every message are decided by
 * `shared/notify.ts`, which the Cloud Functions use too. Local mode used to have
 * its own copy of that logic and the two drifted: production once told the
 * *cancelling* member that they had cancelled, and typed steward messages as
 * `community_reply`. Composing in one module is what stops that happening again.
 */
export function pushDraft(db: LocalDatabase, draft: NotificationDraft): AppNotification {
  return pushNotification(db, {
    uid: draft.uid,
    type: draft.type,
    title: draft.title,
    body: draft.body,
    link: draft.link,
    priority: draft.priority,
  })
}
