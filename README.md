# Éditeur de PDF accessible

Éditeur WYSIWYG permettant de créer des documents PDF conformes PDF/UA, avec structuration sémantique, formulaires interactifs, table des matières, métadonnées et export PDF accessible.

<img width="1468" height="860" alt="" src="https://github.com/user-attachments/assets/329cc04c-79f0-44e7-8f01-20f37123f085" />

---

## Lancement

1. Ouvrir le projet via un serveur HTTP local (ne pas utiliser `file://`).
2. Ouvrir `index.html` dans le navigateur.
3. Les ressources applicatives sont chargées depuis :

   * `dist/editor.min.js`
   * `dist/style.min.css`

L'utilisation d'un serveur local est nécessaire pour :

* le chargement des modules JavaScript ;
* les appels `fetch()` utilisés par le système de chargement des polices ;
* le respect de la politique de sécurité CSP.

Exemples :

```bash
python -m http.server 8000
```

ou

```bash
npx serve .
```

---

## Build

Le projet utilise `build.js` pour concaténer et minifier les sources JavaScript et CSS.

Installation :

```bash
npm install
```

Compilation :

```bash
npm run build
```

ou :

```bash
node build
```

Fichiers générés :

```text
dist/editor.min.js
dist/style.min.css
```

Le bundle JavaScript inclut PDFKit, blob-stream et la logique complète de l'éditeur.

---

## Architecture des fichiers

```text
index.html             — interface HTML et panneaux
build.js               — bundler/minifier pour JS et CSS

dist/
├─ editor.min.js       — application compilée
└─ style.min.css       — feuille de style compilée

src/
├─ css/
│  └─ style.css
└─ js/
   ├─ editor.js
   ├─ pdfExport.js
   ├─ fontLoader.js
   └─ ...
```

---

## Gestion des polices

Le module `fontLoader.js` charge dynamiquement les polices utilisées par l'éditeur.

Les polices sont utilisées à la fois pour :

* l'affichage WYSIWYG ;
* le rendu des blocs dans l'éditeur ;
* l'export PDF via PDFKit.

Les fichiers téléchargés sont convertis en `ArrayBuffer` puis intégrés au document PDF exporté.

### Polices disponibles

- Marianne 
- Open Sans
- Roboto
- Lato
- Montserrat
- Source Sans 3
- Noto Sans

Chaque police est chargée avec les variantes :

* Regular (400)
* Bold (700)
* Italic (400 Italic)
* Bold Italic (700 Italic)

Les caractères accentués français sont pris en charge.

### Police Marianne

La police Marianne est téléchargée dynamiquement depuis le CDN du DSFR :

```text
https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.14.4/dist/fonts/
```

Variantes utilisées :

```text
Marianne-Regular.woff2
Marianne-Bold.woff2
Marianne-Regular_Italic.woff2
Marianne-Bold_Italic.woff2
```

> **Important**
>
> **La police Marianne constitue l'identité typographique de l'État français. Elle doit être utilisée uniquement pour les documents produits ou publiés par l'État français, ses administrations et organismes autorisés.**
>
> Pour les autres usages, il est recommandé d'utiliser l'une des autres polices proposées par l'éditeur.

### CDN

Les autres polices sont récupérées dynamiquement :

1. téléchargement du CSS depuis un CDN ;
2. extraction des règles `@font-face` ;
3. téléchargement des fichiers ;
4. sélection automatique du sous-ensemble latin compatible avec les caractères accentués français.

En cas d'indisponibilité réseau ou d'échec de chargement :

* la police précédemment active est conservée ;
* un message d'erreur est affiché à l'utilisateur.

### Ajouter une police

Ajouter une entrée dans `window.FONT_LIST` :

```js
{
  id: 'inter',
  label: 'Inter',
  cssFamily: "'Inter', sans-serif"
}
```

La famille doit fournir les variantes :

* 400
* 700
* 400 italic
* 700 italic

### Ajouter une police depuis un CDN

```js
{
  id: 'ma-police',
  label: 'Ma Police',
  cssFamily: "'Ma Police', sans-serif",
  urls: {
    regular: 'https://exemple.com/Regular.woff2',
    bold: 'https://exemple.com/Bold.woff2',
    italic: 'https://exemple.com/Italic.woff2',
    bolditalic: 'https://exemple.com/BoldItalic.woff2'
  }
}
```

Formats supportés :

* woff2 (avec limitations)
* woff
* ttf

---

## Fonctionnalités principales

### Interface d'édition

* Palette de blocs à gauche : glisser-déposer un bloc sur une page ou appuyer sur `Entrée` pour l'ajouter au centre de la page 1.
* Déplacement de bloc par la barre de titre.
* Redimensionnement par la poignée inférieure droite.
* Rotation interactive pour formes et tracés.
* Duplication via le bouton `⧉` ou le raccourci `Ctrl+D` / `⌘D`.
* Suppression avec le bouton `×`, `Suppr` ou `Backspace`.
* Ajout de pages avec le bouton `+ Ajouter une page`.

### Panneau droit

#### Onglet Méta

* titre ;
* langue ;
* police du document ;
* auteur ;
* sujet ;
* grille magnétique.

#### Onglet Bloc

* propriétés spécifiques du bloc sélectionné.

#### Onglet UA

* checklist PDF/UA ;
* arbre de structure des tags.

#### Onglet Sauvegarde

* export/import de projet `.pdfua`.

#### Onglet Export

* pagination ;
* table des matières ;
* génération PDF ;
* prévisualisation ;
* export JS.

### Grille magnétique

* aimantation lors du déplacement ;
* aimantation lors du redimensionnement ;
* affichage optionnel ;
* tailles de cellule : 10 / 20 / 40 / 80 px.

---

## Blocs disponibles

| Bloc             | Description                                                               |
| ---------------- | ------------------------------------------------------------------------- |
| Titre H1 → H6    | Titres structurés avec balisage `<H1>`…`<H6>` et signets PDF automatiques |
| Paragraphe       | Texte riche avec gras, italique et liens inline                           |
| Liste à puces    | Liste structurée avec puces et contenu séparé                             |
| Liste numérotée  | Liste structurée avec numérotation automatique                            |
| Image            | `<Figure>` avec texte alternatif (`alt`) et lien optionnel                |
| Lien hypertexte  | `<Link>` avec texte et URL configurables                                  |
| Tableau          | `<Part>` avec cellules éditables et ajout de lignes                       |
| Graphique        | `<Figure>` avec texte alternatif et 4 types de rendu                      |
| Séparateur       | Ligne horizontale décorative exportée comme Artifact                      |
| Encadré          | Section stylée Information / Avertissement / Astuce / Neutre              |
| Bloc de code     | Contenu monospace, fond sombre                                            |
| Champ formulaire | Annotation AcroForm interactive compatible PDF/UA                         |
| Forme décorative | 10 formes vectorielles exportées comme Artifact                           |
| Forme libre      | Tracé vectoriel plume, courbes de Bézier                                  |

---

## Formulaires interactifs

La palette inclut :

* Champ texte
* Zone de texte multiline
* Case à cocher
* Boutons radio
* Liste déroulante

Chaque champ peut définir :

* libellé accessible (`formLabel`) ;
* placeholder ;
* valeur par défaut ;
* options ;
* état coché ;
* champ requis ;
* lecture seule.

---

## Formes décoratives et vectorielles

### Formes décoratives

La palette propose :

* Cercle
* Demi-cercle
* Étoile 5 branches
* Étoile 6 branches
* Triangle
* Losange
* Carré
* Croix
* Flèche
* Vague

Propriétés :

* couleur ;
* opacité ;
* rotation ;
* bordure ;
* épaisseur de trait.

### Forme libre

* clic : point droit ;
* glisser : courbe Bézier ;
* double-clic ou `Entrée` : terminer ;
* `Échap` : annuler ;
* `Suppr` : retirer le dernier point.

Propriétés :

* épaisseur ;
* remplissage ;
* fermeture du chemin ;
* opacité ;
* rotation.

---

## Graphiques

Types disponibles :

* Camembert
* Anneau
* Barres
* Courbes

Chaque graphique peut définir :

* un titre ;
* un texte alternatif obligatoire ;
* les données du graphique.

---

## Export PDF

### Générer le PDF/UA

Produit un fichier PDF téléchargeable incluant :

* structure logique ;
* balises PDF/UA ;
* ordre de lecture ;
* métadonnées ;
* formulaires.

### Prévisualiser

Affiche le PDF généré dans une fenêtre modale.

### Exporter le code JS

Produit un script autonome basé sur PDFKit permettant de reproduire le document.

---

## Options d'export avancées

### Pagination

* affichage sur la première page ou non ;
* position configurable ;
* format configurable.

### Table des matières

* génération automatique ;
* liens internes PDF ;
* insertion automatique ;
* profondeur configurable :

  * H1 ;
  * H1 + H2 ;
  * H1 + H2 + H3.

---

## Conformité PDF/UA

La checklist du panneau **UA** vérifie :

* titre du document ;
* langue déclarée ;
* présence d'un H1 ;
* hiérarchie correcte des titres ;
* présence des textes alternatifs ;
* qualité des liens ;
* document non vide.

L'arbre de structure reflète l'ordre de lecture logique du document indépendamment de sa mise en page visuelle.

---

## Raccourcis clavier

| Touche                | Contexte          | Action                     |
| --------------------- | ----------------- | -------------------------- |
| `Suppr` / `Backspace` | Bloc sélectionné  | Supprimer le bloc          |
| `Ctrl+D` / `⌘D`       | Bloc sélectionné  | Dupliquer le bloc          |
| `Échap`               | Bloc sélectionné  | Désélectionner             |
| `Ctrl+Z` / `⌘Z`       | Global            | Annuler                    |
| `Ctrl+B` / `⌘B`       | Texte sélectionné | Gras                       |
| `Ctrl+I` / `⌘I`       | Texte sélectionné | Italique                   |
| `Entrée` / `Espace`   | Palette           | Ajouter un bloc            |
| `Entrée`              | Mode tracé        | Terminer le tracé          |
| `Échap`               | Mode tracé        | Annuler                    |
| `Suppr` / `Backspace` | Mode tracé        | Effacer le dernier point   |
| `Échap`               | Prévisualisation  | Fermer la modale           |
| `←` `→` `Début` `Fin` | Panneau droit     | Naviguer entre les onglets |

---

## Persistance

* sauvegarde automatique dans `sessionStorage` ;
* restauration automatique au rechargement ;
* historique limité à 50 états.

---

## Sauvegarde et ouverture de projets

### Sauvegarder

Télécharge un fichier `.pdfua` contenant :

* les blocs ;
* les métadonnées ;
* les images encodées ;
* la configuration ;
* les compteurs internes.

### Ouvrir

Recharge intégralement un projet `.pdfua` précédemment sauvegardé.
