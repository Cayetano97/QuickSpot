export type StoredLanguage = "system" | "en" | "es";
export type Language = "en" | "es";

interface Dict {
  placeholder: string;
  noMatches: string;
  runError: string;
  searchAria: string;
  actionsAria: string;
  settingsAria: string;
  minimize: string;
  dragAria: string;
  settingsTitle: string;
  languageLabel: string;
  languageSystem: string;
  magnifyLabel: string;
  done: string;
  addAction: string;
  save: string;
  saveError: string;
  deleteAction: string;
  kindUrl: string;
  kindCommand: string;
  kindApp: string;
  namePlaceholder: string;
  valuePlaceholderUrl: string;
  valuePlaceholderCommand: string;
  valuePlaceholderApp: string;
  browserPlaceholder: string;
  browseApps: string;
  appSearchPlaceholder: string;
  noAppsFound: string;
  saveValidationError: string;
  saveGroupsValidationError: string;
  groupsLabel: string;
  addGroup: string;
  groupNamePlaceholder: string;
  groupColorAria: string;
  noGroup: string;
  groupSelectAria: string;
  deleteGroup: string;
  customColorPlaceholder: string;
  colorInvalid: string;
  colorTooDark: string;
}

const en: Dict = {
  placeholder: "Type to search...",
  noMatches: "No matching actions",
  runError: "Couldn't run: {msg}",
  searchAria: "Search actions",
  actionsAria: "Available actions",
  settingsAria: "Settings",
  minimize: "Minimize to tray",
  dragAria: "Drag to move the window",
  settingsTitle: "Settings",
  languageLabel: "Language",
  languageSystem: "System default",
  magnifyLabel: "Magnify on hover",
  done: "Done",
  addAction: "Add action",
  save: "Save",
  saveError: "Couldn't save: {msg}",
  deleteAction: "Delete {name}",
  kindUrl: "URL",
  kindCommand: "Command",
  kindApp: "App",
  namePlaceholder: "Name",
  valuePlaceholderUrl: "https://example.com",
  valuePlaceholderCommand: "shell command",
  valuePlaceholderApp: "app path or bundle id",
  browserPlaceholder: "Browser executable (url only)",
  browseApps: "Browse apps\u2026",
  appSearchPlaceholder: "Search installed apps\u2026",
  noAppsFound: "No apps found",
  saveValidationError: "Fill in a name and a value for every action",
  saveGroupsValidationError: "Fill in a name and a color for every group",
  groupsLabel: "Groups",
  addGroup: "Add group",
  groupNamePlaceholder: "Group name",
  groupColorAria: "Color of {name}",
  noGroup: "No group",
  groupSelectAria: "Group",
  deleteGroup: "Delete {name}",
  customColorPlaceholder: "#rrggbb",
  colorInvalid: "Enter a 6-digit hex color",
  colorTooDark: "Too dark for the dark theme",
};

const es: Dict = {
  placeholder: "Escribe para buscar...",
  noMatches: "No hay acciones coincidentes",
  runError: "No se pudo ejecutar: {msg}",
  searchAria: "Buscar acciones",
  actionsAria: "Acciones disponibles",
  settingsAria: "Ajustes",
  minimize: "Minimizar a la bandeja",
  dragAria: "Arrastrar para mover la ventana",
  settingsTitle: "Ajustes",
  languageLabel: "Idioma",
  languageSystem: "Idioma del sistema",
  magnifyLabel: "Ampliar al pasar el ratón",
  done: "Listo",
  addAction: "Añadir acción",
  save: "Guardar",
  saveError: "No se pudo guardar: {msg}",
  deleteAction: "Eliminar {name}",
  kindUrl: "URL",
  kindCommand: "Comando",
  kindApp: "App",
  namePlaceholder: "Nombre",
  valuePlaceholderUrl: "https://ejemplo.com",
  valuePlaceholderCommand: "comando del shell",
  valuePlaceholderApp: "ruta o id de la app",
  browserPlaceholder: "Ejecutable del navegador (solo url)",
  browseApps: "Buscar apps\u2026",
  appSearchPlaceholder: "Buscar apps instaladas\u2026",
  noAppsFound: "No se encontraron apps",
  saveValidationError: "Completa el nombre y el valor de cada acción",
  saveGroupsValidationError: "Completa el nombre y el color de cada grupo",
  groupsLabel: "Grupos",
  addGroup: "Añadir grupo",
  groupNamePlaceholder: "Nombre del grupo",
  groupColorAria: "Color de {name}",
  noGroup: "Sin grupo",
  groupSelectAria: "Grupo",
  deleteGroup: "Eliminar {name}",
  customColorPlaceholder: "#rrggbb",
  colorInvalid: "Introduce un color hex de 6 dígitos",
  colorTooDark: "Demasiado oscuro para el tema oscuro",
};

export type DictKey = keyof typeof en;

/** Every localizable key, shared by both languages. */
export const DICT_KEYS = Object.keys(en) as DictKey[];

/** Spanish when the OS reports any Spanish variant; anything else → English. */
export function systemLanguage(): Language {
  if (typeof navigator === "undefined") return "en";
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

/** Effective UI language: explicit override wins; otherwise the OS language. */
export function resolveLanguage(stored: StoredLanguage): Language {
  return stored === "es" || (stored === "system" && systemLanguage() === "es")
    ? "es"
    : "en";
}

export function t(lang: Language, key: DictKey, vars?: Record<string, string>): string {
  const dict = lang === "es" ? es : en;
  let s: string = dict[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
