# Installing the Farabi desktop app

Farabi is one installer per platform. It brings everything it needs with it: there is no
Postgres, Node or anything else to install.

## macOS (13 Ventura or later)

1. Open `Farabi_<version>_aarch64.dmg` (Apple silicon) or `Farabi_<version>_x64.dmg` (Intel).
2. Drag **Farabi** into **Applications**.
3. The app isn't signed yet, so the first launch needs one extra step. Either:
   - in Applications, **right-click Farabi → Open**, then **Open** again in the dialog; or
   - in Terminal: `xattr -dr com.apple.quarantine /Applications/Farabi.app`, then open it normally.

   After that, open it from the Dock, Launchpad or Spotlight like any app.

## Windows (10 or 11, 64-bit)

1. Run `Farabi_<version>_x64-setup.exe`. It installs for your user only; no administrator rights.
2. The installer isn't signed yet, so SmartScreen may say "Windows protected your PC". Click
   **More info → Run anyway**.
3. If WebView2 is missing (rare on Windows 11), the installer downloads it.

Open Farabi from the Start menu.

## First steps

Farabi starts with the **Fake** provider, which writes canned replies so you can try it out. To
use real AI, open **Settings → AI provider**:

- **Claude Code** uses your Claude subscription through the `claude` program. Farabi looks for it
  where the installers put it, even though apps opened from the Dock or Start menu don't see your
  shell's PATH. If it isn't found, use **Choose file…**. If it says *signed out*, run `claude` in a
  terminal, sign in, and press **Recheck**.
- **Claude API** uses an API key. Paste it under **Claude API key**. It is checked, then stored in
  the macOS Keychain or Windows Credential Manager, never in Farabi's data or logs.

To bring over your work from the web app, use **Settings → Data → Import from the web app** while
this Farabi is still empty. The web app's Postgres must be running. The import happens once, copies
everything or nothing, and upgrades data from an older version on the way in without changing the
old database.

## Where your data lives

| | macOS | Windows |
|---|---|---|
| Data (projects, feedback, screenshots, backups) | `~/Library/Application Support/app.farabi/` | `%APPDATA%\app.farabi\` |
| Logs | `~/Library/Logs/app.farabi/` | `%LOCALAPPDATA%\app.farabi\logs\` |

**Settings → Data** shows both folders, with a button to open each one.

Inside the data folder:

- `store/` is the database. Don't copy or edit it while Farabi is running.
- `backups/` holds a copy taken before every update that changes the data (the newest 5), and an
  automatic snapshot every 10 minutes while you work, plus one when you quit (the newest 6).
  **Settings → Data → Snapshots → Restore…** puts one back; the data it replaces is kept in
  `backups/replaced-…`.
- `feedback/attachments/` holds feedback screenshots. If you choose a **Feedback export** folder,
  `FEEDBACK.md` and copies of the screenshots are written there for Claude Code.

## Updating

Install the new version over the old one. On the next launch Farabi backs up your data, then
updates it. If an update fails, it puts the backup back and tells you. If you open data that a
newer Farabi has already updated, an older Farabi refuses to touch it.

## Uninstalling

Uninstalling keeps your data, so a reinstall picks up where you left off.

- **macOS**: drag Farabi from Applications to the Trash. To remove your data too, delete the two
  folders above.
- **Windows**: Settings → Apps → Farabi → Uninstall. The uninstaller has an unchecked
  **Delete the application data** box; tick it only if you want your data and logs gone as well.

## Developers

`npm run dev` runs the app from source (data in `.farabi-dev/`), and `npm run desktop:build`
makes the installer for the machine you're on. Repo scripts such as `npm run feedback:addressed`
work on the installed app's data by default, with the app open or closed; `-- --data-dir <folder>`
picks another. See `specs/011-tauri-desktop-app/contracts/cli.md`.
