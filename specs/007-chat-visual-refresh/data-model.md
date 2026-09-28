# Data Model: Chat Bubble and Input Visual Refresh

No data model changes (spec: Key Entities: none; FR-010).

- No new tables, columns, migrations, schemas or API fields.
- No new client state. `viewStore` drafts, scroll positions and settings are unchanged.
- Message `role` and `status` are only read, through the existing `data-role` attribute and
  `failed` class, to choose styling.
- Provenance states (Article I) are untouched. The visual split between user-authored and AI
  content already existed and becomes stronger.
