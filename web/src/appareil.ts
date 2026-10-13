// Le nom de cet appareil, lisible dans « Tes appareils » (brique 74) : « Chrome sur Windows ». Partagé par l'entrée de
// l'application et par celle de la console (web/console) : un seul nom pour un même navigateur.
export function nomDeCetAppareil() {
  const n = navigator.userAgent;
  const nav = /Edg\//.test(n) ? 'Edge' : /Firefox\//.test(n) ? 'Firefox' : /Chrome\//.test(n) ? 'Chrome' : /Safari\//.test(n) ? 'Safari' : 'Navigateur';
  const os = /Android/.test(n) ? 'Android' : /iPhone|iPad/.test(n) ? 'iPhone' : /Windows/.test(n) ? 'Windows' : /Mac OS X|Macintosh/.test(n) ? 'Mac' : /Linux/.test(n) ? 'Linux' : '';
  return os ? `${nav} sur ${os}` : nav;
}
