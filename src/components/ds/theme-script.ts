export const THEME_KEY = "ll-theme";

/**
 * Runs in <head> before first paint: applies the stored preference (localStorage, then cookie,
 * then the OS setting) to <html data-theme>, so there is never a flash of the wrong theme.
 */
export const THEME_SCRIPT = `(function(){try{var k='${THEME_KEY}';var p=null;try{p=localStorage.getItem(k)}catch(e){}if(!p){var m=document.cookie.match(/(?:^|; )ll-theme=([a-z]+)/);p=m?m[1]:'system'}var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.dataset.theme=d?'dark':'light';r.dataset.themePref=p;}catch(e){}})();`;
