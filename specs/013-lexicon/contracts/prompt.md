# Contract: the `<lexicon>` block

`ReplyInput.lexicon?: Array<{ id; v; slot; instruction }>` (optional; absent/empty → no block).

`buildReplyRequest` system blocks, in order:
1. `REPLY_SYSTEM` (stable)
2. branch context (when the reply is in a branch)
3. length guidance (when a level is set)
4. **lexicon block** (when the answered message has terms)

The block, exactly (terms in `SLOT_ORDER`, then id; instruction text escaped `&`, `<`, `>`, `"`):

```text
<lexicon>
The person attached these terms from their prompting lexicon to their latest message. They are the person's explicit request: apply each one as defined. Where a term sets the length or scope of the reply, it takes precedence over the general length guidance.
<term id="distill" v="1" slot="operation">…instruction…</term>
<term id="bulleted-list" v="1" slot="format">…instruction…</term>
</lexicon>
```

The message turns are unchanged: the person's text is sent exactly as stored. Claude Code headless
mode joins the system blocks, so it receives the same block.
