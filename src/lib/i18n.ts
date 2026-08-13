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
  actionsTitle: string;
  addActions: string;
  languageLabel: string;
  languageSystem: string;
  magnifyLabel: string;
  autostartLabel: string;
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
  browseApps: string;
  appSearchPlaceholder: string;
  noAppsFound: string;
  saveValidationError: string;
  saveGroupsValidationError: string;
  generalLabel: string;
  actionsLabel: string;
  actionsCount: string;
  noActions: string;
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
  close: string;
  actionsDescription: string;
  actionNameLabel: string;
  actionTypeLabel: string;
  actionValueLabel: string;
  actionGroupLabel: string;
  groupNameLabel: string;
  groupColorLabel: string;
  reorderHint: string;
  groupActions: string;
  actionsGrouped: string;
  moveActionUp: string;
  moveActionDown: string;
  actionMoved: string;
  tabsAria: string;
  actionsTab: string;
  groupsTab: string;
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
  actionsTitle: "Actions",
  addActions: "Add actions",
  languageLabel: "Language",
  languageSystem: "System default",
  magnifyLabel: "Magnify on hover",
  autostartLabel: "Launch at login",
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
  browseApps: "Browse apps\u2026",
  appSearchPlaceholder: "Search installed apps\u2026",
  noAppsFound: "No apps found",
  saveValidationError: "Fill in a name and a value for every action",
  saveGroupsValidationError: "Fill in a name and a color for every group",
  generalLabel: "General",
  actionsLabel: "Actions",
  actionsCount: "{count} actions",
  noActions: "No actions yet. Use “Add action” to create the first one.",
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
  close: "Close",
  actionsDescription: "Manage groups and actions. Use the Up and Down buttons to set action order.",
  actionNameLabel: "Name",
  actionTypeLabel: "Type",
  actionValueLabel: "Value",
  actionGroupLabel: "Group",
  groupNameLabel: "Name",
  groupColorLabel: "Color",
  reorderHint: "Use the Up and Down buttons to set the launcher order.",
  groupActions: "Group actions",
  actionsGrouped: "Actions grouped by group",
  moveActionUp: "Move {name} up",
  moveActionDown: "Move {name} down",
  actionMoved: "{name} moved to position {position} of {count}",
  tabsAria: "Action editor sections",
  actionsTab: "Actions",
  groupsTab: "Groups",
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
  actionsTitle: "Acciones",
  addActions: "Añadir acciones",
  languageLabel: "Idioma",
  languageSystem: "Idioma del sistema",
  magnifyLabel: "Ampliar al pasar el ratón",
  autostartLabel: "Iniciar con el sistema operativo",
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
  browseApps: "Buscar apps\u2026",
  appSearchPlaceholder: "Buscar apps instaladas\u2026",
  noAppsFound: "No se encontraron apps",
  saveValidationError: "Completa el nombre y el valor de cada acción",
  saveGroupsValidationError: "Completa el nombre y el color de cada grupo",
  generalLabel: "General",
  actionsLabel: "Acciones",
  actionsCount: "{count} acciones",
  noActions: "Aún no hay acciones. Usa «Añadir acción» para crear la primera.",
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
  close: "Cerrar",
  actionsDescription: "Gestiona grupos y acciones. Usa los botones Arriba y Abajo para ordenar las acciones.",
  actionNameLabel: "Nombre",
  actionTypeLabel: "Tipo",
  actionValueLabel: "Valor",
  actionGroupLabel: "Grupo",
  groupNameLabel: "Nombre",
  groupColorLabel: "Color",
  reorderHint: "Usa los botones Arriba y Abajo para definir el orden del lanzador.",
  groupActions: "Agrupar acciones",
  actionsGrouped: "Acciones agrupadas por grupo",
  moveActionUp: "Subir {name}",
  moveActionDown: "Bajar {name}",
  actionMoved: "{name} movida a la posición {position} de {count}",
  tabsAria: "Secciones del editor de acciones",
  actionsTab: "Acciones",
  groupsTab: "Grupos",
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
