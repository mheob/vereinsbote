---
'web': minor
---

Send waves: right before each mail the outbox checks its contacts again (suppressions, exits, opt-outs, invalid or changed addresses), fills the mail with current values and adds the wave's attachments and a personal unsubscribe link, also as a one-click `List-Unsubscribe` header. A wave can be stopped, and an unclear mail can be sent again after a person checked it.
