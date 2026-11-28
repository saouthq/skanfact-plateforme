// Un motif rangé comme une phrase (« La fiche … ») repris après deux-points : sa majuscule tombe, sauf un sigle (« RIB »).
// (1.389.6, CONS3-6 : « … seule : La facture » se lisait comme deux textes collés.)
export const dansLaPhrase = (m: string) => (/^\p{Lu}\p{Ll}/u.test(m) ? m.charAt(0).toLowerCase() + m.slice(1) : m);
