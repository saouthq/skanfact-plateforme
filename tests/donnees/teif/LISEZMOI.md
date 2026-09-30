# Le schéma TEIF 1.8.8 — pour les tests seulement

`teif-1.8.8-withoutSig.xsd` est le schéma de la facture électronique tunisienne (TTN, El Fatoora,
version 1.8.8, sans signature), dans sa forme **XSD 1.0**. La TTN le publie en XSD 1.1, que
`xmllint` ne sait pas lire ; cette version 1.0 est celle produite par le projet open source
[ayoubgaouet/tn-einvoice-validator](https://github.com/ayoubgaouet/tn-einvoice-validator) (licence
MIT) : il retire les quatre constructions XSD 1.1 (deux `xs:assert` sur le matricule fiscal, deux
`xs:alternative`), et rien d'autre. Les deux assertions retirées sont relues par le test lui-même
(`tests/v10/efacture.test.ts`, « matriculesXsd11 » ; dans le dépôt `skanfact`, `test/suites/teif.js`).

Recopié du dépôt `skanfact` (`test/fixtures/teif/`) à la brique 80. Il ne sert qu'aux tests : le serveur ne le charge jamais. Le jour où la TTN publie une
nouvelle version, on remplace ce fichier et on relance les tests — c'est le contrat.
