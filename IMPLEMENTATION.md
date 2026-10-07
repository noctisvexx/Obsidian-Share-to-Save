# Mobile-first clipper implementation

## Stage 1

Markdown discovery and conversion are removed. Sharing uses the existing injected
Save Webpage action, the input modal, or `obsidian://share-to-save?url=...`.
Existing Markdown and its attachments are never migrated.

Tasks live in `_ShareToSave/queue` inside the Vault, allowing the user's existing
sync to transport them. This folder must be included in that sync. Tasks have a
type, schema version, ID, timestamps and pending/processing/failed/completed
states. Completion records remain as receipts; errors remain for manual retry.
Expired processing tasks can be retried explicitly. Legacy files are deleted only
after reading and verifying the migrated destination; unknown JSON is retained.

Attachments use Obsidian's public attachment-path API by default, or a custom
Vault folder. New embeds use full Vault paths. Binary names use SHA-256 digests;
existing references and attachments are left untouched. Shared files use the same
location policy. Existing notes keep their original filenames. New clips use
`Clip-{taskId}.md` to make saves idempotent across retries and devices.

File sync does not expose a distributed transaction or compare-and-swap. Claims
prevent simultaneous consumers sharing one current filesystem, but disconnected
devices can both parse a task. Deterministic note paths prevent different note
names for the same task, while sync-provider conflict copies remain possible.
This requires real multi-device testing and is not an exactly-once guarantee.

Automated tests use a fake Vault. Android sharing UI, relative default attachment
placement, device suspension, real network responses and sync conflict handling
require Obsidian/Android validation. No platform availability is claimed.
