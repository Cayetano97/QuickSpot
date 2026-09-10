# quickspot-mcp

Servidor MCP (Model Context Protocol) para gestionar las acciones de QuickSpot desde cualquier agente de IA: OpenCode, Claude Code, Claude Desktop, Cursor, VS Code Copilot, Windsurf, Gemini CLI o Codex CLI.

Solo edita `quickspot.config.json` con las **mismas reglas de validación que el backend Rust** (`src-tauri/src/config.rs`). Nunca ejecuta acciones. Local, sin cuentas ni red.

## Tools

| Tool | Qué hace |
| --- | --- |
| `list-actions` | Lista acciones (índice, nombre, tipo, valor, grupo) |
| `get-config` | Vuelca el config completo + ruta resuelta |
| `create-action` | Crea una acción (`url`, `command`, `app`, `file`, `folder`, `sequence` de hasta 5 pasos) |
| `update-action` | Modifica por índice o nombre (`null` borra `browser`/`hint`/`group`/`steps`) |
| `delete-action` | Elimina por índice o nombre |
| `move-action` | Reordena (el orden define el ranking de búsqueda) |
| `list-groups` / `create-group` / `delete-group` | Gestiona grupos de color `#rrggbb` |
| `validate-config` | Valida sin modificar (cuenta ignoradas por el backend) |

Recurso de lectura: `quickspot://config`.

> Tras cada cambio, pulsa `Cmd/Ctrl+R` en QuickSpot (o bandeja → Reload config). La app no vigila el fichero.

## Instalación

**Opción A — desde un Release (recomendado, sin clonar nada):** descarga `quickspot.mcpb` (Claude Desktop: doble-click o Settings → Extensions → Install) o `dist/index.js` y regístralo:

```sh
node /ruta/descargada/quickspot-mcp.js            # pregunta antes de instalar (opt-in)
node /ruta/descargada/quickspot-mcp.js --yes      # agentes/CI: sin pregunta
node /ruta/descargada/quickspot-mcp.js --status   # verifica
```

**Opción B — desde este repo (o para que una IA lo instale):** ver [`INSTALL.md`](INSTALL.md) — un solo comando, igual en macOS, Windows y Linux.

## Desarrollo

```sh
npm ci && npm test && npm run build          # tests + bundle autocontenido dist/index.js
QUICKSPOT_CONFIG=/tmp/qs.json node scripts/e2e-check.mjs   # smoke test del protocolo stdio
npm run pack-mcpb                             # genera quickspot.mcpb para Claude Desktop
```
