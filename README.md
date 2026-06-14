# Éditeur de PDF accessible

Éditeur WYSIWYG pour créer des documents PDF conformes PDF/UA.

<img width="1468" height="860" alt="" src="https://github.com/user-attachments/assets/329cc04c-79f0-44e7-8f01-20f37123f085" />

---

## Lancement

1. Ouvrir `index.html` dans un navigateur **via un serveur local** (pas en `file://`).
2. Le chargement des ressources se fait à partir de `dist/style.min.css` et `dist/editor.min.js`.

---

## Build

Ce projet utilise `build.js` pour concaténer et minifier les sources JavaScript + CSS.

- Exécuter `npm install` pour installer les dépendances de build.
- Exécuter `npm run build` ou `node build.js` pour générer :
  - `dist/editor.min.js`
  - `dist/style.min.css`

Le bundle JavaScript inclut PDFKit, `blob-stream` et la logique de l'éditeur.

---

## Architecture des fichiers

```
index.html             — interface HTML et panneaux
build.js               — bundler/minifier pour JS et CSS
dist/editor.min.js     — application + PDFKit + blob-stream
dist/style.min.css     — styles minifiés
src/css/style.css      — styles source de l'éditeur
src/js/                — modules source de l'éditeur
fonts/                 — polices
```

`fontLoader.js` charge dynamiquement les polices à partir de `fonts/` ou d'une URL, et les rend disponibles pour le rendu WYSIWYG et l'export PDF.

---

## Fonctionnalités principales

### Interface d'édition

- Palette de blocs à gauche : glisser-déposer un bloc sur une page ou appuyer sur `Entrée` pour l'ajouter au centre de la page 1.
- Déplacement de bloc par la barre de titre.
- Redimensionnement par la poignée inférieure droite.
- Rotation interactive pour formes et tracés.
- Duplication via le bouton `⧉` ou le raccourci `Ctrl+D` / `⌘D`.
- Suppression avec le bouton `×`, `Suppr` ou `Backspace`.
- Ajout de pages avec le bouton `+ Ajouter une page`.

### Panneau droit

- Onglet **Méta** : titre, langue, police de document, auteur, sujet, grille magnétique.
- Onglet **Bloc** : propriétés spécifiques du bloc sélectionné.
- Onglet **UA** : checklist PDF/UA et arbre de structure des tags.
- Onglet **Sauvegarde** : exporter/importer un projet `.pdfua`.
- Onglet **Export** : options de pagination, table des matières, génération PDF, prévisualisation et export JS.

### Grille magnétique

- Aimanter sur la grille pour le déplacement et le redimensionnement.
- Afficher une grille avec points aux intersections.
- Taille de cellule : 10 / 20 / 40 / 80 px.

---

## Blocs disponibles

| Bloc | Description |
|------|-------------|
| Titre H1 → H6 | Titres structurés avec balisage `<H1>`…`<H6>` et signets PDF automatiques |
| Paragraphe | Texte riche avec gras, italique et liens inline |
| Liste à puces | Liste structurée avec puces et contenu séparé |
| Liste numérotée | Liste structurée avec numérotation automatique |
| Image | `<Figure>` avec texte alternatif (`alt`) et lien optionnel |
| Lien hypertexte | `<Link>` avec texte et URL configurables |
| Tableau | `<Part>` avec cellules éditables et ajout de lignes |
| Graphique | `<Figure>` avec texte alternatif et 4 types de rendu |
| Séparateur | Ligne horizontale décorative exportée comme Artifact |
| Encadré | Section stylée Information / Avertissement / Astuce / Neutre |
| Bloc de code | Contenu monospace, fond sombre |
| Champ formulaire | Annotation AcroForm interactive compatible PDF/UA |
| Forme décorative | 10 formes vectorielles exportées comme Artifact |
| Forme libre | Tracé vectoriel plume, courbes de Bézier |

---

## Formulaires interactifs

La palette inclut des champs de formulaire PDF :
- Champ texte
- Zone de texte multiline
- Case à cocher
- Boutons radio
- Liste déroulante

Chaque champ peut définir :
- libellé accessible (`formLabel`)
- placeholder
- valeur par défaut
- options (pour les listes déroulantes)
- état coché / requis / lecture seule

Les champs génèrent des annotations AcroForm PDF conformes PDF/UA avec des attributs de description accessibles.

---

## Formes décoratives et vectorielles

### Formes décoratives

La palette propose 10 formes décoratives :
- Cercle
- Demi-cercle
- Étoile 5 branches
- Étoile 6 branches
- Triangle
- Losange
- Carré
- Croix
- Flèche
- Vague

Propriétés : couleur, opacité, rotation, bordure, épaisseur de trait.

### Forme libre

- Cliquer sur **Forme libre** active le mode tracé.
- Clic pour poser un point droit.
- Glisser pour dessiner une courbe Bézier.
- Double-clic ou `Entrée` pour terminer.
- `Échap` pour annuler, `Suppr` pour retirer le dernier point.
- Propriétés : épaisseur du tracé, remplissage, fermeture du chemin, opacité, rotation.

---

## Graphiques

Quatre types de graphiques sont pris en charge :
- Camembert
- Anneau
- Barres
- Courbes

Chaque graphique peut définir un titre et un texte alternatif obligatoire pour la conformité PDF/UA. Les données sont saisies ligne par ligne dans le panneau Bloc.

---

## Export PDF

### Générer le PDF/UA

- `Générer le PDF/UA` produit un fichier `.pdf` téléchargeable.
- Le rendu inclut la structure, l'ordre de lecture, les balises et les métadonnées nécessaires.

### Prévisualiser

- `Prévisualiser` ouvre une modale intégrant le PDF généré.

### Exporter le code JS

- `Exporter le code JS` crée un script autonome basé sur PDFKit.
- Ce script peut être réutilisé hors de l'éditeur pour reproduire le même document.

---

## Options d'export avancées

- Pagination : activer / masquer sur la première page, position et format de numérotation.
- Table des matières : générer une page de TdM avec liens internes PDF.
- Profondeur de TdM : H1 / H1+H2 / H1+H2+H3.
- Insertion automatique de la TdM après la première page.

---

## Conformité PDF/UA

La checklist en temps réel du panneau **UA** vérifie :
- titre du document
- langue déclarée
- présence d'au moins un H1
- hiérarchie des titres
- images avec texte alternatif
- liens signifiants
- document non vide

L'arbre de structure reflète l'ordre de lecture logique PDF/UA, indépendant de la mise en page visuelle.

---

## Raccourcis clavier

| Touche | Contexte | Action |
|--------|----------|--------|
| `Suppr` / `Backspace` | Bloc sélectionné | Supprimer le bloc |
| `Ctrl+D` / `⌘D` | Bloc sélectionné | Dupliquer le bloc |
| `Échap` | Bloc sélectionné | Désélectionner |
| `Ctrl+Z` / `⌘Z` | Global | Annuler la dernière action |
| `Ctrl+B` / `⌘B` | Texte sélectionné | Gras |
| `Ctrl+I` / `⌘I` | Texte sélectionné | Italique |
| `Entrée` / `Espace` | Palette | Ajouter un bloc |
| `Entrée` | Mode tracé | Terminer le tracé |
| `Échap` | Mode tracé | Annuler le tracé |
| `Suppr` / `Backspace` | Mode tracé | Effacer le dernier point |
| `Échap` | Prévisualisation | Fermer la modal |
| `←` `→` `Début` `Fin` | Panneau droit | Naviguer entre les onglets |

---

## Persistance

- État de l'éditeur sauvegardé automatiquement dans `sessionStorage`.
- Restauration automatique au rechargement.
- Historique des annulations limité à 50 états.

---

## Sauvegarde et ouverture de projets

- `Sauvegarder` : télécharge un fichier `.pdfua` contenant l'état complet du document.
- `Ouvrir` : restaure un projet à partir d'un fichier `.pdfua`.
- Le format inclut blocs, métadonnées, images encodées, configuration de la grille et compteur d'ID.
