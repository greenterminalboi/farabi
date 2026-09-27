@AGENTS.md

## Feedback

The user logs feedback about Farabi in the app. It is exported to `feedback/FEEDBACK.md`
(git-ignored, regenerated on every change; screenshots are at the paths it lists).

- Read `feedback/FEEDBACK.md` for outstanding items; each heading is the item's full id.
- After finishing the work for an item, run `npm run feedback:addressed -- <id>`. It only marks
  `open` items addressed; the user confirms or reopens them in the app.
- Never edit `FEEDBACK.md`, the attachment files or the `feedback_*` tables directly, and never
  mark anything resolved: that is the user's decision.
