# dsh-ide-codeintel

Code intelligence for the DeepSeek Harness: local and semantic completion, go to definition,
find usages, hover and signature help, plus the language servers (TypeScript / Python /
Java-JDTLS / YAML) and their memory budget.

> **Requires the IDE workbench plugin [`dsh-ide-workbench`](../workbench)**: the editor, the status
> bar and the settings page all belong to the workbench. Installed **alone**, the plugin still
> loads normally, shows a clear guidance, starts **no** language server and throws **no**
> uncaught exception.

## What it gives you

| Capability | Shortcut / entry |
|---|---|
| Local completion | while typing (`fo` in a `.ts` file) |
| Semantic completion | server side completions when a language server is available |
| Go to definition | `F12` / Ctrl+click |
| Find usages (semantic) | `Alt+F7` |
| Find usages (text, marked "text match") | `Alt+F8` |
| Hover / signature help | hover / trigger the signature |
| Ctrl-hover highlight | hold Ctrl |
| Search popup | find in files, with a context preview |
| The "semantic analysis" cell of the status bar | ready / idle / conservative / starting |
| The memory budget | the settings page and the diagnostics panel |

## Install

```bash
dsh plugin --profile web add dsh-ide-codeintel
```

## Settings

The plugin has **its own settings file**: `<profile>/dsh-codeintel/settings.json`, holding the
memory budget, the idle policy, the index memory and the four semantic shortcuts. On its first
start it imports those values **once** from the settings file of the workbench, so an upgrade
loses nothing.

## The boundary to the workbench

- The workbench **does not know** that this plugin exists (no import, no probing, no dependency).
- The **CodeMirror runtime belongs to the workbench**; this plugin reaches it through the
  contract and a lazy proxy ⇒ the page holds **one** `@codemirror/state` and the `instanceof`
  checks of the editor keep working.
- **The automatic closing of the brackets lives on both sides**: when both are installed, this
  plugin wins (priority 100) and the workbench gives way — the brackets close **once**, and the
  outcome does **not** depend on the order the plugins were loaded in.
- An uncaught exception of this plugin **stays inside this plugin**: it does not kill the DSH
  host and it does not bring the workbench down.

## License

MIT
