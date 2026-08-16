/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/*
  Les types des modules que Vite fabrique à la volée.

  `virtual:pwa-register/react` n'existe sur aucun disque : le greffon PWA le
  produit pendant la construction. Sans cette référence, TypeScript ne peut pas le
  trouver — et comme le frontend n'était jamais type-vérifié, l'erreur n'a jamais
  été vue. Elle apparaît dès qu'on branche la vérification.
*/
