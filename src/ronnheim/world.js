// Ronnheim, un jeu de survie vu de dessus : une île dont le cœur est une prairie,
// entourée de la forêt noire. Dans la prairie on ramasse des branches, des pierres et du silex, cueille
// framboises et champignons, coupe des arbres, chasse le cerf (qui fuit) et le sanglier (qui charge),
// repousse les grisets (qui laissent de la résine), et invoque Eikthyr, le grand cerf, sur son autel.
// Dans la forêt noire, sombre (des sapins, des pins), rôdent les nains gris, les squelettes et les
// trolls ; on y trouve des myrtilles, des carottes sauvages
// (à replanter), de l'étain sur les plages et des gisements de cuivre : fondus puis alliés à la forge,
// ils font le bronze de la hache qui seule abat les bouleaux. On y bâtit une base : un établi, des
// planchers, des murs, des portes, un lit (où l'on revient), des torches, une fonderie, une forge, un
// chaudron. Le bouclier arrête les coups, et les pare levé au bon moment ; à la mort, tout reste dans
// une tombe.
// Ici les règles et le monde, que floor fait tourner pour tous (voir index.js) ; le jeu lui-même est
// un programme à part (le dépôt ronnheim), que Ronnie sait télécharger et lancer.
// Les distances sont en pixels du monde (une case fait TILE pixels), les temps en secondes.

const dungeon = require('./crypt')

const TILE = 16
const SIDE = 2048
const SIZE = TILE * SIDE
// Le monde : de la mer, et de grandes îles semées au hasard (qu'on ne traverse pas en un jour : des
// avant-postes, des portails). Celle du départ au milieu ; les autres, de tant à tant, de tel à tel
// rayon (en cases), séparées d'au moins `channel` cases de mer (trop pour la nager : il faut un bateau).
const ISLANDS = { home: 280, count: [7, 12], radius: [150, 400], channel: 45 }
// La prairie et la forêt noire se partagent chaque île par grandes taches, jusqu'au bord de l'eau ;
// autour du départ, la prairie, sur tant de cases.
const MEADOW_HOME = 70
// L'eau peu profonde : tant de cases depuis la rive (on y patauge) ; au-delà, on nage.
const SHALLOW = 2
// Le relief (voir `landform`) : tant de paliers au plus, des collines de tant de cases, leur niveau de
// la mer et leur raideur ; on remonte en tant de cases depuis l'eau ; un palier de moins de tant de
// cases est raboté ; une rampe pour tant de cases d'un palier, pas plus près que tant d'une autre ; le
// bit des rampes.
const RELIEF = { levels: 3, hills: 140, sea: 0.4, steep: 2.4, falloff: 6, smallest: 150, pocket: 60, rampEvery: 1800, rampRoom: 24, ramp: 8 }
// Les rivières : une pour tant de cases de rayon d'île, de telle à telle demi-largeur (en cases) ; elles
// partent de l'intérieur et coulent jusqu'à la mer (il faut un pont, ou nager).
const RIVERS = { per: 90, width: [2.5, 4.5] }
// Ce que les comptes (arbres, bêtes, buissons, ce qui traîne par terre) visaient : la terre de la
// première île. Ils suivent la terre qu'il y a (une île deux fois plus grande, deux fois plus d'arbres).
const LAND_REF = 34000
// Le chemin d'une bête en chasse, quand un mur la gêne : cherché à moins de tant de cases, en voyant
// tant de cases au plus, refait toutes les tant de secondes (ou quand sa proie a bougé).
const PATH = { reach: 48, nodes: 6000, every: 1 }
// Une bête loin de tous les joueurs dort (elle ne pense plus) : au-delà de tant.
const AWAKE = 1400

// Les cases : l'herbe (trois tons, pour l'œil), le chemin, le sable, l'eau (l'eau profonde fait le
// tour), le sol de la forêt noire ; les murs et les dalles des cryptes.
const T = { grass: '0', dark: '1', light: '2', path: '3', sand: '4', water: '5', deep: '6', forest: '7', cryptwall: '8', crypt: '9' }
const CRYPT_TILES = new Set([T.cryptwall, T.crypt])
// Les cryptes de la forêt noire : un mausolée pour `per` cases
// de forêt noire ; son escalier descend dans un donjon à part (voir crypt.js), posé hors de l'île, à
// partir de `band` (en x et en y), chacun à `stride` du suivant (assez pour qu'on ne s'y voie pas). Un
// donjon où plus personne n'est (ni aucune tombe) depuis `reset` secondes se défait : il se refera,
// autrement, à la prochaine descente. Le mausolée prend tant de pixels de part et d'autre de son milieu,
// et tant au-dessus de son seuil ; sa porte, tant de part et d'autre, s'y enfonce de tant (on y entre en
// marchant : le jeu demande alors à descendre).
// Dehors, tant de squelettes (dont une part d'archers) gardent chaque mausolée, sans s'en éloigner de
// plus de `post` ; tués, ils reviennent au bout de `guardsBack` secondes (une journée du jeu).
const CRYPT = { per: 4000, band: SIZE + 2048, stride: 4096, reset: 1800, w: 30, h: 44, door: 9, deep: 14, guards: 3, archers: 0.35, post: 140, guardsBack: 1440 }
// Ce que donnent les coffres des donjons ([sorte, min, max, chance]...) : au moins la première chose. Le
// grand coffre de la salle du trésor donne plus, dont deux cœurs de surtling (de quoi faire un portail).
const COFFER = [['bonefragments', 2, 5, 0.8], ['resin', 3, 6, 0.4], ['arrow', 6, 14, 0.4], ['flintarrow', 4, 10, 0.3], ['greydwarfeye', 1, 3, 0.3], ['copperore', 2, 4, 0.3], ['tinore', 2, 3, 0.25], ['surtlingcore', 1, 1, 0.3]]
const VAULT = [['surtlingcore', 2, 2, 1], ['bonefragments', 4, 8, 1], ['bronze', 2, 4, 0.6], ['flintarrow', 10, 20, 0.6], ['copper', 2, 4, 0.5], ['bronzenails', 10, 20, 0.3]]
// Ce qu'il y a dans un donjon : l'escalier qui remonte (on y monte en marchant : le jeu demande alors à
// remonter), les coffres, les braseros, les pointes, les os. `solid` : on ne passe pas (tant de pixels de
// part et d'autre, tant au-dessus du pied) ; `loot` : ce qu'il y a dedans.
const PROPS = {
  stairs: {},
  coffer: { solid: [8, 7], loot: COFFER },
  vault: { solid: [12, 8], loot: VAULT },
  brazier: { solid: [5, 5] },
  spikes: {},
  bones: {}
}
// Les pointes : sorties `up` secondes toutes les `every` (chacune à son moment : une vague parcourt la
// salle), elles font tant à qui est dessus (pas plus d'une fois par `again` secondes).
const SPIKES = { every: 3, up: 1, dmg: 14, again: 1 }
// Le générateur de squelettes : tant que quelqu'un est à moins de `reach` (et dans sa salle), il en
// appelle un toutes les `every` secondes, pas plus de `max` à la fois.
const SPAWNER = { every: 7, max: 3, reach: 220 }
const WET = new Set([T.water, T.deep])
const GRASS = new Set([T.grass, T.dark, T.light])
// Où l'on peut planter.
const SOIL = new Set([...GRASS, T.forest])

// Les joueurs : vitesse de marche et de course (le jeu vérifie l'endurance).
const WALK = 70
const RUN = 125
// De la marge sur ce qu'un joueur peut parcourir entre deux positions (la latence, le hasard des paquets).
const MOVE_SLACK = 1.6
// Un coup arrivé un peu avant la fin du précédent compte quand même (le réseau ne les porte pas tous
// aussi vite) : le jeu attend déjà le temps de l'outil.
const HIT_SLACK = 0.06
// Un saut d'une falaise (en descendant) : tant de cases au plus.
const JUMP = 3.2
// La nage : le jeu tient l'endurance ; à bout, on perd tant de vie par seconde.
const DROWN = 5
// La vie et l'endurance sans rien dans le ventre ; la nourriture les augmente (voir FOODS).
const BASE_HP = 25
const BASE_STAMINA = 50
// La santé revient de tant par seconde (plus tant par repas en cours), tant de secondes après le dernier coup.
const REGEN = 0.2
const REGEN_FOOD = 0.2
const REGEN_AFTER = 8
// La portée du ramassage, d'un feu (pour y cuire, l'alimenter), de l'autel.
const PICK_REACH = 34
const FIRE_REACH = 40
const ALTAR_REACH = 50
// Où l'on peut poser un feu (depuis soi), et l'écart avec les arbres, rochers et autres feux.
const BUILD_REACH = 60
const BUILD_ROOM = 18
// Une construction se pose ou se démonte d'assez près ; les pièces en bois veulent un établi pas loin.
const PIECE_REACH = 90
const BENCH_RANGE = 160
// Aucune bête n'apparaît à moins de tant d'un établi (la base est à l'abri des retours ; celles qui
// passent peuvent toujours y entrer).
const NO_SPAWN = 480
// L'établi monte d'un niveau pour chaque extension posée à moins de tant de lui :
// le billot, la table de tannage.
const EXTENSIONS = ['choppingblock', 'tanningrack']
const EXTENSION_RANGE = 80
// Un outil, une arme ou un vêtement s'améliore jusqu'à tant : la qualité q demande un poste de niveau q.
const QUALITY_MAX = 3
// Ce qu'une qualité de plus ajoute : aux dégâts (et à la coupe, la pioche, aux flèches), à l'armure.
const QUALITY_DMG = 0.3
const QUALITY_ARMOR = 2
// On se sert d'une construction (porte, lit, fonderie) d'aussi près que ça de son milieu.
const USE_REACH = 56
// D'une construction qui sert (un poste de travail, la fonderie, un coffre, une porte, un lit) : collé à
// elle, à moins de tant de son bord.
const TOUCH = 12

// Ce qu'on tient en main : dégâts aux bêtes, coups pour abattre un arbre (chop) et la dureté qu'on
// peut abattre (tier : 2 pour les bouleaux), coups pour casser un rocher (mine), temps entre deux
// coups, portée ; `blunt` : il assomme (les squelettes le craignent), `pierce` : il perce (eux non) ;
// `both` : il faut les deux mains (pas de bouclier).
const TOOLS = {
  hand: { dmg: 6, every: 0.45, reach: 30, blunt: true },
  club: { dmg: 13, every: 0.65, reach: 32, blunt: true },
  knife: { dmg: 10, every: 0.32, reach: 26 },
  spear: { dmg: 20, every: 0.8, reach: 44, pierce: true },
  torch: { dmg: 8, every: 0.5, reach: 30, blunt: true },
  axe: { dmg: 12, chop: 1, tier: 1, every: 0.6, reach: 30 },
  flintaxe: { dmg: 15, chop: 2, tier: 1, every: 0.6, reach: 30 },
  bronzeaxe: { dmg: 22, chop: 3, tier: 2, every: 0.6, reach: 32 },
  pickaxe: { dmg: 10, mine: 1, every: 0.75, reach: 32 },
  bronzepickaxe: { dmg: 14, mine: 2, every: 0.7, reach: 32 },
  bronzesword: { dmg: 28, every: 0.55, reach: 36 },
  bronzemace: { dmg: 26, every: 0.65, reach: 34, blunt: true },
  bow: { dmg: 4, every: 0.5, reach: 28, arrow: 22, range: 170, both: true },
  // Le marteau (en main, on construit) et le cultivateur (en main, on retourne la terre et on plante) :
  // de piètres armes.
  hammer: { dmg: 5, every: 0.5, reach: 28, blunt: true },
  cultivator: { dmg: 3, every: 0.5, reach: 28 },
  finebow: { dmg: 4, every: 0.5, reach: 28, arrow: 32, range: 240, both: true }
}
// Le combat. Les coups s'enchaînent : un coup donné moins de `chain` secondes après que le précédent est
// prêt continue la série, et le troisième (le coup final) fait `finisher` fois plus et repousse de
// `push`. L'attaque lourde (le jeu l'arme un instant avant) fait `heavy` fois plus, repousse de
// `heavyPush` et fait chanceler (`stagger` secondes : le coup que la bête armait tombe à l'eau), sauf les
// grosses bêtes ; avec la lance, on la lance (voir `spear`). Une bête frappée dans le dos, qui ne s'en
// prend pas à vous, prend `sneak` fois plus (`sneakKnife` au couteau). La roulade : aucun coup ne porte pendant `iframes`
// secondes, pas plus d'une toutes les `roll` secondes, à `rollSpeed` (floor l'accepte).
const COMBAT = { chain: 0.5, finisher: 1.6, push: 10, heavy: 2.2, heavyPush: 22, stagger: 1, sneak: 2, sneakKnife: 4, iframes: 0.3, roll: 0.6, rollSpeed: 220 }
// La lance lancée : sa vitesse, sa portée, ses dégâts (fois ceux du coup) ; elle tombe là où elle s'arrête.
const SPEAR = { speed: 300, range: 220, dmg: 2.5 }
// Le squelette au bouclier (tant de squelettes en portent un) : un coup de face n'en fait que tant ;
// l'attaque lourde le brise (il chancelle).
const SHIELDED = { share: 0.3, through: 0.2 }
// Les flèches, de la meilleure à la moins bonne (l'arc tire la meilleure qu'on a) : les dégâts en plus.
const AMMO = { flintarrow: 6, arrow: 0 }
const ARROW_SPEED = 330
// La flèche d'un arc à peine bandé va moins loin et fait moins mal (de tant à tout, selon le bandage
// que le jeu dit : bander use l'endurance).
const DRAWN_MIN = 0.4
const SHOOT_EVERY = 0.7

// Ce qu'on porte : où, et l'armure que ça donne. Les dégâts reçus baissent avec
// l'armure (voir `absorb`). Du plus simple au plus solide : les haillons (le cuir du sanglier), le cuir (la peau du
// cerf), la peau de troll, le bronze. Le bouclier se porte au bras (voir SHIELDS).
const WEAR = {
  ragtunic: { slot: 'chest', armor: 1 },
  ragpants: { slot: 'legs', armor: 1 },
  leatherhelmet: { slot: 'head', armor: 2 },
  tunic: { slot: 'chest', armor: 2 },
  pants: { slot: 'legs', armor: 2 },
  deercape: { slot: 'back', armor: 1 },
  trollhelmet: { slot: 'head', armor: 6 },
  trolltunic: { slot: 'chest', armor: 6 },
  trollpants: { slot: 'legs', armor: 6 },
  trollcape: { slot: 'back', armor: 1 },
  bronzehelmet: { slot: 'head', armor: 8 },
  bronzeplate: { slot: 'chest', armor: 8 },
  bronzegreaves: { slot: 'legs', armor: 8 },
  woodshield: { slot: 'shield', armor: 0 },
  towershield: { slot: 'shield', armor: 0 },
  bronzebuckler: { slot: 'shield', armor: 0 }
}

// Les boucliers : ce qu'ils arrêtent d'un coup (block, plus tant par qualité), et la parade (parry : le
// bouclier levé juste avant le coup, dans les PARRY secondes, arrête parry fois plus et étourdit la
// bête ; le grand bouclier ne pare pas, mais ralentit moins la marche qu'il ne protège).
const SHIELDS = {
  woodshield: { block: 10, parry: 1.5 },
  towershield: { block: 20, parry: 0 },
  bronzebuckler: { block: 16, parry: 2 }
}
const SHIELD_QUALITY = 4
const PARRY = 0.25
// Une bête parée reste étourdie tant de secondes, et prend deux fois plus de coups pendant ce temps.
const STUN_TIME = 2
const STUN_DMG = 2
// Ce que coûte un coup arrêté en endurance (le jeu la tient : floor le lui dit), selon sa force.
const BLOCK_STAMINA = 10
const PARRY_STAMINA = 4

// Ce qui se mange : la vie et l'endurance en plus tant que ça dure (secondes). Trois repas à la fois,
// jamais deux fois le même (sauf presque fini). Les plats cuisinés au feu valent plus que leurs
// ingrédients.
const FOODS = {
  raspberry: { hp: 7, stamina: 20, time: 600 },
  blueberries: { hp: 8, stamina: 25, time: 600 },
  mushroom: { hp: 15, stamina: 15, time: 900 },
  carrot: { hp: 10, stamina: 32, time: 900 },
  cooked: { hp: 30, stamina: 10, time: 1200 },
  carrotsoup: { hp: 15, stamina: 45, time: 1500 },
  jam: { hp: 14, stamina: 40, time: 1800 }
}
const MEALS = 3
// Un repas déjà en cours se reprend quand il en reste moins que tant.
const MEAL_AGAIN = 0.3

// Les arbres : coups pour les abattre, la dureté (il faut une hache d'au moins ce tier), ce qu'ils
// laissent ([sorte, combien, chance]...), quand ils repoussent.
// Le hêtre et le bouleau poussent dans la prairie, le sapin et le pin dans la
// forêt noire (le pin donne le bois de cœur).
const TREES = {
  beech: { hp: 6, tier: 1, loot: [['wood', 4, 1]] },
  birch: { hp: 5, tier: 2, loot: [['finewood', 3, 1], ['wood', 1, 1]] },
  fir: { hp: 6, tier: 1, loot: [['wood', 4, 1]] },
  pine: { hp: 7, tier: 1, loot: [['wood', 2, 1], ['corewood', 2, 1], ['corewood', 1, 0.5]] }
}
// Une souche : tant de coups de hache pour l'arracher (l'arbre ne repousse pas).
const STUMP_HP = 3
// Les rochers et les gisements de cuivre et d'étain : coups de pioche, ce qu'ils laissent, s'ils
// reviennent (le minerai, jamais).
const ROCKS = {
  stone: { hp: 8, loot: [['stone', 5], ['flint', 2]] },
  copper: { hp: 12, loot: [['copperore', 4], ['stone', 2]], once: true },
  tin: { hp: 10, loot: [['tinore', 3], ['stone', 1]], once: true }
}
// Les gisements d'étain : tant (à l'échelle de la terre), dans la forêt noire, à moins de tant de l'eau.
const TIN = { count: 25, shore: 40 }
const ROCK_BACK = 15 * 60
// Les buissons : combien, ce qu'on y cueille, quand les fruits reviennent (3000 s).
const BUSHES = { raspberry: { count: 40, n: [2, 3] }, blueberry: { count: 50, n: [2, 4] } }
const BUSH_BACK = 50 * 60
// Le jour et la nuit : une minute du jeu dure une seconde, la journée 24 minutes ; l'aube à 6 h, la
// nuit de 18 h à 6 h (la seconde moitié). On ne dort qu'à la nuit tombée.
const DAY = 24 * 60
const NIGHT = 12 * 60
// La pluie, par moments : tant de secondes de pluie, puis tant de temps sec (entre les deux bornes).
const RAIN = [120, 300]
const DRY = [480, 1200]
// Les choses qui traînent par terre, et combien la nature en remet (vérifié de temps en temps).
const LITTER = { branch: 220, stone: 200, flint: 180, mushroom: 80, wildcarrot: 15 }
const LITTER_EVERY = 30
// Ce qu'on ramasse sous un autre nom.
const PICKS_AS = { branch: 'wood', wildcarrot: 'carrot' }
// Un objet posé par terre par un joueur (ou laissé par une bête) finit par disparaître.
const DROP_TIME = 10 * 60

// Les bêtes : santé, vitesse, ce qu'elles laissent ([sorte, min, max]...), combien selon le biome
// (prairie ou forêt). Les méchantes (`hostile`) foncent sur qui passe à moins de `sight`, et frappent :
// elles lèvent le bras (`windup` secondes : on peut reculer, ou parer) puis le coup tombe. Les nains gris
// chassent en bande (`pack` : ceux d'à côté suivent). `weak` : ce qui leur fait plus ou moins mal.
const BEASTS = {
  deer: { hp: 40, walk: 26, run: 105, loot: [['meat', 1, 2], ['hide', 1, 1], ['antler', 0, 1]], count: { meadow: 20 } },
  // Le sanglier blessé charge (`charge`, comme l'élan du nain gris : il gratte le sol, puis fonce tout
  // droit), puis s'éloigne `back` secondes et revient à l'assaut.
  boar: { hp: 50, walk: 22, run: 95, loot: [['meat', 1, 2], ['leather', 1, 2]], count: { meadow: 14 }, charge: { min: 30, max: 150, every: 3, windup: 0.5, time: 0.6, speed: 210, dmg: 13, back: 1.3 } },
  greyling: { hp: 20, walk: 24, run: 64, loot: [['resin', 1, 2]], count: { meadow: 8 }, hostile: { sight: 100, dmg: 6, every: 1.4, reach: 18, windup: 0.35 } },
  // Le nain gris jette des cailloux d'un peu loin (`throw` : entre `min` et `max`, à peu près toutes les
  // `every` secondes ; il lève le bras `windup` secondes, le caillou vole à `speed` sur `range`), et
  // frappe de près.
  greydwarf: { hp: 40, walk: 28, run: 88, loot: [['resin', 1, 2], ['stone', 0, 1], ['greydwarfeye', 0, 2]], count: { forest: 40 }, pack: 150, hostile: { sight: 140, dmg: 12, every: 1.3, reach: 20, windup: 0.4, throw: { min: 35, max: 150, every: 3.5, windup: 0.45, speed: 170, range: 200, dmg: 8 } } },
  // Le squelette : il garde la forêt (quelques-uns rôdent dans la prairie), craint la massue, pas les flèches.
  skeleton: { hp: 40, walk: 26, run: 84, loot: [['bonefragments', 1, 3]], count: { forest: 12, meadow: 2 }, weak: { blunt: 2, pierce: 0.5 }, hostile: { sight: 140, dmg: 15, every: 1.5, reach: 22, windup: 0.45 } },
  // Le squelette archer (dans la forêt noire, autour des mausolées, dans les donjons) : il garde ses distances (recule sous `near`, tire sous `range`, ses
  // flèches volent à `speed`), arme son arc avant de tirer (on peut s'écarter, ou lever le bouclier).
  archer: { hp: 30, walk: 28, run: 70, loot: [['bonefragments', 1, 2], ['arrow', 2, 5]], count: { forest: 6, meadow: 1 }, weak: { blunt: 2, pierce: 0.5 }, hostile: { sight: 170, dmg: 12, every: 2.2, reach: 22, windup: 0.6 }, ranged: { range: 150, near: 50, speed: 240 } },
  // Le générateur de squelettes des donjons (un tas d'os maudit) : il ne bouge pas (`fixed`, voir SPAWNER) ;
  // la massue le brise mieux que les flèches.
  spawner: { hp: 160, walk: 0, run: 0, loot: [['bonefragments', 3, 6], ['surtlingcore', 0, 1]], count: {}, fixed: true, weak: { blunt: 1.5, pierce: 0.3 } },
  // Le troll : grand et lent, lent à frapper (on voit venir la massue), et le coup abat les arbres
  // autour. D'un peu loin, il jette un rocher (`toss` : entre `min` et `max`, toutes les `every`
  // secondes) : il le soulève `windup` secondes, et l'endroit visé se voit au sol ; le rocher y tombe
  // `delay` secondes après qu'il l'a visé (de quoi en sortir), et touche qui est à moins de `radius`.
  // Rare : tué, un autre ne revient pas avant une heure (`back`).
  troll: { hp: 300, walk: 16, run: 42, loot: [['trollhide', 3, 5], ['greydwarfeye', 1, 2]], count: { forest: 6 }, size: 1.8, back: 3600, hostile: { sight: 180, dmg: 50, every: 2.4, reach: 34, windup: 0.6, toss: { min: 70, max: 240, every: 9, windup: 0.8, delay: 2, radius: 28, dmg: 40 } }, smash: { radius: 30, trees: 42 } }
}
// Les bêtes à étoiles : une étoile, deux fois plus de vie et moitié plus de dégâts ;
// deux étoiles, trois fois plus de vie et deux fois plus de dégâts ; leur butin d'autant. La chance d'en
// croiser une (une étoile, deux) selon le pays ; la nuit, deux fois plus.
const STARS = { hp: [1, 2, 3], dmg: [1, 1.5, 2], loot: [1, 2, 3], chance: { meadow: [0.06, 0.01], forest: [0.15, 0.04], mausoleum: [0.15, 0.04], crypt: [0.25, 0.08] } }
// La taille d'une bête (pour la toucher), Eikthyr compris.
const sizeOf = (b) => (b.kind === 'eikthyr' ? 2.2 : BEASTS[b.kind]?.size ?? 1)
// Le cerf fuit un joueur qui court à moins de tant, ou qui marche à moins de tant (s'approcher à pas de loup).
// Une bête en rage ne s'éloigne pas de plus de tant d'où la poursuite a commencé : elle lâche, rentre,
// et laisse les joueurs tranquilles tant de secondes (on peut la semer).
const CHASE_MAX = 420
const CALM_TIME = 8
const DEER_HEARS_RUN = 120
const DEER_HEARS_WALK = 60
const FLEE_TIME = 6
// Une bête en rage court après sa proie tant de secondes (relancé tant qu'elle la voit), mord tant
// toutes les tant de secondes, à cette distance (le sanglier).
const RAGE_TIME = 9
const BITE = { dmg: 11, every: 1.2, reach: 20, windup: 0.3 }
// Les bêtes reviennent quand il en manque, lentement : toutes les BEASTS_EVERY secondes, au plus
// BEASTS_BACK du compte de chaque sorte (un pays vidé met plus d'une demi-heure à se repeupler), et
// jamais à moins de BEAST_FAR d'un joueur (hors de sa vue). Une sorte qui a `back` (le troll) ne revient
// pas avant tant de secondes après qu'on en a tué une.
const BEASTS_EVERY = 120
const BEASTS_BACK = 0.05
const BEAST_FAR = 900

// Eikthyr, le grand cerf : invoqué sur l'autel avec SUMMON bois de cerf. Sa santé (plus pour chaque
// joueur en plus autour), sa vitesse, ses coups : les bois devant lui, la charge, les éclairs (annoncés
// au sol un instant avant). Il ne s'éloigne pas de son autel, et y retourne quand personne ne l'affronte.
const SUMMON = { antler: 2 }
const SUMMON_DELAY = 2.5
const BOSS = {
  hp: 500, hpPerPlayer: 250, walk: 58, charge: 240, leash: 460, sight: 650, giveUp: 25,
  melee: { dmg: 22, reach: 40, every: 1.6, windup: 0.5 },
  chargeEvery: [8, 12], chargeTime: 0.9, chargeDmg: 20,
  boltEvery: [5, 8], boltDelay: 1.1, boltRadius: 30, boltDmg: 24,
  loot: [['hardantler', 3], ['trophy', 1]]
}

// Les feux : combien de secondes de bois au départ, ce qu'une bûche ajoute, le maximum ; la cuisson.
const FIRE_START = 180
const FIRE_LOG = 90
const FIRE_MAX = 600
const COOK_TIME = 6
// Tant de viandes à la fois sur un feu.
const COOK_MAX = 2
// La fonderie : un minerai et une bûche donnent un lingot, en tant de secondes ; tant à la fois.
const SMELT_TIME = 12
const SMELT_MAX = 10
const SMELTS = { copperore: 'copper', tinore: 'tin' }

// Ce qu'on construit : ce qu'il faut, la place prise en cases (w × h), si l'on marche dessus (flat) ou
// non, s'il faut un établi pas loin (bench), et comment on peut la tourner (rots : 0 comme dessinée,
// 1 en quart de tour, w et h échangés ; 2 retournée gauche-droite ; 3 le quart de tour retourné). Par
// défaut : 0 et 2 ; l'établi, le lit, la fonderie, la forge et le portail se tournent dans les quatre sens. La porte : de
// face (0, on passe vers le haut ou le bas) ou de profil (1, vers les côtés). Le feu de camp se pose où
// l'on veut (voir `build`).
const PIECES = {
  workbench: { need: { wood: 10 }, w: 2, h: 1, rots: [0, 1, 2, 3] },
  choppingblock: { need: { wood: 10, flint: 10 }, w: 1, h: 1, bench: true },
  tanningrack: { need: { wood: 10, flint: 20, leather: 10, hide: 2 }, w: 1, h: 1, bench: true },
  floor: { need: { wood: 1 }, w: 1, h: 1, flat: true, bench: true, rots: [0] },
  wall: { need: { wood: 2 }, w: 1, h: 1, bench: true, rots: [0] },
  // La barrière (basse) et la palissade (des pieux taillés) : elles arrêtent les bêtes comme un mur,
  // mais ne font pas un chez-soi.
  fence: { need: { wood: 1 }, w: 1, h: 1, bench: true, rots: [0] },
  palisade: { need: { wood: 4 }, w: 1, h: 1, bench: true, rots: [0, 1] },
  door: { need: { wood: 4 }, w: 1, h: 1, bench: true, rots: [0, 1] },
  bed: { need: { wood: 8, hide: 2 }, w: 2, h: 1, bench: true, rots: [0, 1, 2, 3] },
  // Le tapis en peau de cerf : à plat, sur le sol ou sur un plancher (`cover`) ; il
  // rend un chez-soi plus confortable (on y reste reposé plus longtemps).
  rug: { need: { hide: 4 }, w: 2, h: 1, cover: true, bench: true, rots: [0, 1] },
  // Le pont : des planches posées sur l'eau (`water`), par cases ; on y marche.
  bridge: { need: { wood: 2 }, w: 1, h: 1, flat: true, water: true, bench: true, rots: [0, 1] },
  standingtorch: { need: { wood: 2, resin: 2 }, w: 1, h: 1, rots: [0] },
  smelter: { need: { stone: 20, wood: 5, surtlingcore: 5 }, w: 2, h: 1, rots: [0, 1, 2, 3], bench: true },
  forge: { need: { stone: 4, wood: 10, copper: 6 }, w: 2, h: 1, rots: [0, 1, 2, 3], bench: true },
  // Deux portails du même nom : on passe de l'un à l'autre.
  portal: { need: { finewood: 20, greydwarfeye: 10, surtlingcore: 2 }, w: 2, h: 1, rots: [0, 1, 2, 3], bench: true },
  chest: { need: { wood: 10 }, w: 1, h: 1, bench: true },
  // Le chaudron : sur un feu allumé (à moins de CAULDRON_FIRE), on y fait la soupe et la confiture.
  cauldron: { need: { tin: 10 }, w: 1, h: 1, bench: true, rots: [0] },
  // Le poste de cuisson : une broche posée sur un feu ; la viande cuit dessus, pas
  // à même le feu.
  cookingstation: { need: { wood: 2 }, w: 1, h: 1, bench: true, rots: [0] }
}
const CAULDRON_FIRE = 30
// Ce qui se pose sur un feu (en visant le feu), un seul à la fois.
const ON_FIRE = new Set(['cauldron', 'cookingstation'])
for (const def of Object.values(PIECES)) def.rots ??= [0, 2]
const PORTAL_NAME = 16
// Les bateaux : le radeau (du bois, du cuir, de la résine : lent, mais de quoi passer
// d'une île à l'autre au début) et le drakkar (du bois fin et des clous en bronze : rapide). Posés sur
// l'eau depuis la rive, près d'un établi. On y monte à tant de pixels ; deux bateaux pas plus près que
// BOAT_ROOM.
const BOATS = {
  raft: { need: { wood: 20, leather: 6, resin: 6 } },
  boat: { need: { finewood: 30, bronzenails: 80, hide: 10, resin: 20 } }
}
const BOAT = BOATS.boat
const BOAT_REACH = 44
const BOAT_ROOM = 34
// La place qu'une pièce prend, tournée ainsi.
const sized = (def, rot) => (rot % 2 ? { w: def.h, h: def.w } : { w: def.w, h: def.h })
// Une carotte plantée pousse en tant de secondes (trois stades ; 4000 à 5000 s : un peu
// plus de deux jours), et en donne tant.
const GROW = 4500
const HARVEST = 3
// Ce qui se plante au cultivateur : ce qu'il faut, en combien de secondes ça pousse (trois stades), ce
// que ça donne. La carotte va sur la terre retournée et s'arrache en se récoltant ; une graine d'arbre
// devient un arbre (le hêtre et le bouleau dans la prairie, le sapin et le pin dans la forêt
// noire) ; un buisson ou des champignons se récoltent, et repoussent (la moitié du temps).
const BUSH_GROW = 2400
const PLANTS = {
  carrot: { need: { carrot: 1 }, grow: GROW, gives: ['carrot', HARVEST], tilled: true, once: true },
  beechseeds: { need: { beechseeds: 1 }, grow: 2400, tree: 'beech', wild: false },
  birchseeds: { need: { birchseeds: 1 }, grow: 2400, tree: 'birch', wild: false },
  firecone: { need: { firecone: 1 }, grow: 2400, tree: 'fir', wild: true },
  pinecone: { need: { pinecone: 1 }, grow: 2400, tree: 'pine', wild: true },
  raspberrybush: { need: { raspberry: 10 }, grow: BUSH_GROW, gives: ['raspberry', 3] },
  blueberrybush: { need: { blueberries: 10 }, grow: BUSH_GROW, gives: ['blueberries', 3] },
  mushroompatch: { need: { mushroom: 10 }, grow: BUSH_GROW, gives: ['mushroom', 3] }
}
// La souche arrachée laisse parfois sa graine (tant de chances sur une).
const SEEDS = { beech: 'beechseeds', birch: 'birchseeds', fir: 'firecone', pine: 'pinecone' }
const SEED_CHANCE = 0.35
// Une graine d'arbre veut de la place : pas d'arbre (ni de pousse) à moins de tant.
const SAPLING_ROOM = 22

// Ce que le menu de construction montre, dans l'ordre : le feu, les pièces, et planter une carotte.
const BUILDS = [
  { id: 'fire', need: { stone: 5, wood: 2 } },
  ...Object.entries(PIECES).map(([id, p]) => ({ id, need: p.need, bench: !!p.bench, w: p.w, h: p.h, rots: p.rots })),
  { id: 'raft', need: BOATS.raft.need, bench: true, water: true },
  { id: 'boat', need: BOAT.need, bench: true, water: true },
  // Le cultivateur en main : retourner la terre (dans l'herbe ou la forêt), puis y planter.
  { id: 'till', need: {}, tool: 'cultivator' },
  ...Object.entries(PLANTS).map(([id, p]) => ({ id, need: p.need, tool: 'cultivator' }))
]

// Ce qu'on fabrique, dans l'ordre montré : ce qu'il faut, ce qu'on obtient, et où (null : n'importe où,
// sinon près d'un établi, d'une forge ou d'un chaudron sur un feu allumé), et le niveau du poste qu'il
// faut (1 par défaut). Sans établi on ne fait que la hache en pierre, la massue et
// la torche.
const RECIPES = [
  // Le marteau : il le faut pour construire (et démonter).
  { id: 'hammer', need: { wood: 3, stone: 2 }, gives: ['hammer', 1], at: null },
  { id: 'axe', need: { wood: 5, stone: 4 }, gives: ['axe', 1], at: null },
  { id: 'club', need: { wood: 6 }, gives: ['club', 1], at: null },
  { id: 'torch', need: { wood: 1, resin: 1 }, gives: ['torch', 1], at: null },
  { id: 'knife', need: { wood: 2, flint: 4, leather: 2 }, gives: ['knife', 1], at: 'workbench' },
  { id: 'flintaxe', need: { wood: 4, flint: 6 }, gives: ['flintaxe', 1], at: 'workbench' },
  { id: 'spear', need: { wood: 5, flint: 10, leather: 2 }, gives: ['spear', 1], at: 'workbench' },
  { id: 'bow', need: { wood: 10, leather: 8 }, gives: ['bow', 1], at: 'workbench' },
  { id: 'arrows', need: { wood: 8 }, gives: ['arrow', 20], at: 'workbench' },
  { id: 'flintarrows', need: { wood: 8, flint: 2 }, gives: ['flintarrow', 20], at: 'workbench' },
  { id: 'woodshield', need: { wood: 10, resin: 4, leather: 4 }, gives: ['woodshield', 1], at: 'workbench' },
  { id: 'towershield', need: { wood: 10, leather: 6 }, gives: ['towershield', 1], at: 'workbench' },
  { id: 'ragtunic', need: { leather: 5 }, gives: ['ragtunic', 1], at: 'workbench' },
  { id: 'ragpants', need: { leather: 5 }, gives: ['ragpants', 1], at: 'workbench' },
  { id: 'pickaxe', need: { wood: 10, hardantler: 1 }, gives: ['pickaxe', 1], at: 'workbench' },
  // Le cuir de cerf et les os, à l'établi de niveau 2.
  { id: 'leatherhelmet', need: { hide: 6, bonefragments: 2 }, gives: ['leatherhelmet', 1], at: 'workbench', level: 2 },
  { id: 'tunic', need: { hide: 6, bonefragments: 2 }, gives: ['tunic', 1], at: 'workbench', level: 2 },
  { id: 'pants', need: { hide: 6, bonefragments: 2 }, gives: ['pants', 1], at: 'workbench', level: 2 },
  { id: 'deercape', need: { hide: 4, bonefragments: 5 }, gives: ['deercape', 1], at: 'workbench', level: 2 },
  { id: 'trollhelmet', need: { trollhide: 5, bonefragments: 3 }, gives: ['trollhelmet', 1], at: 'workbench', level: 2 },
  { id: 'trolltunic', need: { trollhide: 5 }, gives: ['trolltunic', 1], at: 'workbench', level: 2 },
  { id: 'trollpants', need: { trollhide: 5 }, gives: ['trollpants', 1], at: 'workbench', level: 2 },
  { id: 'trollcape', need: { trollhide: 10, bonefragments: 10 }, gives: ['trollcape', 1], at: 'workbench', level: 2 },
  { id: 'finebow', need: { finewood: 10, corewood: 10, hide: 2 }, gives: ['finebow', 1], at: 'workbench', level: 2 },
  // Au chaudron (posé sur un feu) : la soupe, la confiture.
  { id: 'carrotsoup', need: { carrot: 3, mushroom: 1 }, gives: ['carrotsoup', 1], at: 'cauldron' },
  { id: 'jam', need: { raspberry: 8, blueberries: 6 }, gives: ['jam', 4], at: 'cauldron' },
  { id: 'bronze', need: { copper: 2, tin: 1 }, gives: ['bronze', 1], at: 'forge' },
  { id: 'bronzeaxe', need: { wood: 4, bronze: 8, leather: 2 }, gives: ['bronzeaxe', 1], at: 'forge' },
  { id: 'bronzesword', need: { wood: 2, bronze: 8, leather: 2 }, gives: ['bronzesword', 1], at: 'forge' },
  { id: 'bronzemace', need: { wood: 4, bronze: 8, leather: 3 }, gives: ['bronzemace', 1], at: 'forge' },
  { id: 'bronzepickaxe', need: { wood: 3, bronze: 10 }, gives: ['bronzepickaxe', 1], at: 'forge' },
  { id: 'bronzebuckler', need: { wood: 4, bronze: 10 }, gives: ['bronzebuckler', 1], at: 'forge' },
  { id: 'cultivator', need: { wood: 5, bronze: 5 }, gives: ['cultivator', 1], at: 'forge' },
  { id: 'bronzehelmet', need: { bronze: 5, hide: 2 }, gives: ['bronzehelmet', 1], at: 'forge' },
  { id: 'bronzeplate', need: { bronze: 5, hide: 2 }, gives: ['bronzeplate', 1], at: 'forge' },
  { id: 'bronzegreaves', need: { bronze: 5, hide: 2 }, gives: ['bronzegreaves', 1], at: 'forge' },
  { id: 'bronzenails', need: { bronze: 1 }, gives: ['bronzenails', 10], at: 'forge' }
]
const RECIPE = Object.fromEntries(RECIPES.map((r) => [r.id, r]))
// Ce qu'on peut tenir en main.
const TOOLS_HELD = new Set(Object.keys(TOOLS).filter((k) => k !== 'hand'))
// Ce qui s'améliore (outils, armes, vêtements ; pas la torche) : la recette qui le fait. Une qualité de
// plus coûte la moitié (arrondie au-dessus) de la recette, au même poste, de niveau la qualité visée.
const UPGRADES = Object.fromEntries(RECIPES.filter((r) => r.gives[1] === 1 && r.at !== 'cauldron' && !['torch', 'hammer', 'cultivator'].includes(r.gives[0]) && (TOOLS[r.gives[0]] || WEAR[r.gives[0]])).map((r) => [r.gives[0], r]))
const upgradeCost = (r) => Object.fromEntries(Object.entries(r.need).map(([k, n]) => [k, Math.ceil(n / 2)]))

// Les cases de l'inventaire (8 par rangée), et la longueur d'un nom de chose.
const SLOTS = 40
// Ce que tient un coffre : tant de sortes de choses (autant qu'on veut de chacune).
const CHEST_KINDS = 10
const KIND_MAX = 24

// Un hasard qui se répète à partir d'une graine (mulberry32).
function seeded (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Un bruit doux (des valeurs au hasard sur une grille de pas `step`, lissées entre elles), de 0 à 1.
function noise (random, side, step) {
  const n = Math.ceil(side / step) + 2
  const grid = Array.from({ length: n * n }, () => random())
  const smooth = (t) => t * t * (3 - 2 * t)
  return (x, y) => {
    const gx = x / step
    const gy = y / step
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const tx = smooth(gx - x0)
    const ty = smooth(gy - y0)
    const v = (i, j) => grid[Math.min(j, n - 1) * n + Math.min(i, n - 1)]
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx
    return a + (b - a) * ty
  }
}

// Le sac : une pile tient tant de choses d'une sorte (au-delà, une case de plus) ;
// chaque chose pèse ; on porte CARRY au plus (au-delà de 90 %, on avance lentement ; au bout, plus du
// tout : le jeu le fait, floor refuse qu'on bouge).
const CARRY = 300
const STACK = { meat: 20, cooked: 20, carrotsoup: 10, jam: 10, arrow: 100, flintarrow: 100, bronzenails: 100, trophy: 20, antler: 20, hardantler: 10, surtlingcore: 20, copperore: 30, tinore: 30, copper: 30, tin: 30, bronze: 30 }
const WEIGHT = {
  wood: 2, finewood: 2, corewood: 2, stone: 2, flint: 1, resin: 0.3, meat: 1, cooked: 1, leather: 1, hide: 1, trollhide: 2,
  antler: 1, hardantler: 2, trophy: 2, copperore: 10, tinore: 10, copper: 6, tin: 6, bronze: 6, bronzenails: 0.5,
  arrow: 0.1, flintarrow: 0.1, raspberry: 0.1, blueberries: 0.1, mushroom: 0.1, carrot: 0.3, carrotsoup: 1, jam: 1,
  greydwarfeye: 0.2, surtlingcore: 1, bonefragments: 0.5, beechseeds: 0.1, birchseeds: 0.1, firecone: 0.1, pinecone: 0.1,
  hammer: 2, axe: 1, flintaxe: 1.5, bronzeaxe: 2, club: 2, knife: 0.3, spear: 1.5, pickaxe: 2, bronzepickaxe: 2.5,
  bronzesword: 1.5, bronzemace: 2.5, bow: 1, finebow: 1, torch: 1, cultivator: 3,
  ragtunic: 1, ragpants: 1, leatherhelmet: 1, tunic: 2, pants: 2, deercape: 1, trollhelmet: 3, trolltunic: 5,
  trollpants: 5, trollcape: 1, bronzehelmet: 3, bronzeplate: 10, bronzegreaves: 8, woodshield: 3, towershield: 6, bronzebuckler: 4
}
// Ce qui se porte ou se tient en main : un par case.
const stackOf = (kind) => (TOOLS[kind] || WEAR[kind] ? 1 : STACK[kind] ?? 50)
const weightOf = (kind) => WEIGHT[kind] ?? 1

// Un ordre de cases venu du jeu, nettoyé : des noms courts ou null, chacun une fois, SLOTS au plus.
function arrange (before, order) {
  if (!Array.isArray(order)) return before
  const seen = new Set()
  return order.slice(0, SLOTS).map((k) => {
    if (typeof k !== 'string' || !k || k.length > KIND_MAX || seen.has(k)) return null
    seen.add(k)
    return k
  })
}

// Un tableau sorte → nombre relu de la base : seulement des nombres entiers positifs.
const clean = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, n]) => k.length <= KIND_MAX && Number.isInteger(n) && n > 0))

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// Une grille pour retrouver vite ce qui est près d'un point (arbres, rochers, feux) : des cases de CELL
// pixels, chacune avec ce qui s'y trouve.
const CELL = 32
class Grid {
  constructor () {
    this.cells = new Map()
  }

  key (x, y) {
    return Math.floor(x / CELL) * 4096 + Math.floor(y / CELL)
  }

  add (o) {
    const k = this.key(o.x, o.y)
    if (!this.cells.has(k)) this.cells.set(k, [])
    this.cells.get(k).push(o)
  }

  delete (o) {
    const list = this.cells.get(this.key(o.x, o.y))
    if (list) list.splice(list.indexOf(o) >>> 0, list.includes(o) ? 1 : 0)
  }

  // Ce qui est à moins de `r` (à peu près : les cases touchées) de (x, y).
  near (x, y, r) {
    const out = []
    const [x0, x1, y0, y1] = [Math.floor((x - r) / CELL), Math.floor((x + r) / CELL), Math.floor((y - r) / CELL), Math.floor((y + r) / CELL)]
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(cx * 4096 + cy)
        if (list) out.push(...list)
      }
    }
    return out
  }
}
const between = ([lo, hi], random) => lo + random() * (hi - lo)

// Les dégâts qui passent l'armure : moins l'armure, ou bien moins si elle est forte.
function absorb (dmg, armor) {
  if (armor <= 0) return dmg
  return armor < dmg / 2 ? dmg - armor : (dmg * dmg) / (4 * armor)
}

// L'île : la prairie au milieu, la forêt noire autour, l'eau sur les bords, quelques étangs, des
// chemins de terre. Renvoie les cases (une chaîne, ligne par ligne), le centre (où l'on apparaît) et
// la forêt (1 par case dans la forêt noire, plages et étangs compris).
function terrain (random) {
  const tiles = new Array(SIDE * SIDE).fill(T.deep)
  const forest = new Uint8Array(SIDE * SIDE)
  const land = noise(random, SIDE, 13)
  const coast = noise(random, SIDE, 34)
  const capes = noise(random, SIDE, 70)
  const ponds = noise(random, SIDE, 18)
  const tone = noise(random, SIDE, 8)
  const woods = noise(random, SIDE, 22)
  const patches = noise(random, SIDE, 110)
  const c = SIDE / 2
  // Les îles : celle du départ au milieu, les autres semées autour, un bras de mer entre chacune.
  const islands = [{ x: c, y: c, r: ISLANDS.home, wild: 0.5 }]
  const [n0, n1] = ISLANDS.count
  const want = n0 + Math.floor(random() * (n1 - n0 + 1))
  for (let k = 0; k < 20000 && islands.length < want; k++) {
    const [r0, r1] = ISLANDS.radius
    const r = r0 + random() * (r1 - r0)
    const x = r * 1.4 + random() * (SIDE - r * 2.8)
    const y = r * 1.4 + random() * (SIDE - r * 2.8)
    if (islands.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + r) * 1.1 + ISLANDS.channel)) continue
    // `wild` : le seuil de la forêt noire (plus il est bas, plus il y en a) ; certaines îles en sont pleines.
    islands.push({ x, y, r, wild: 0.2 + random() * 0.55 })
  }
  // Pour chaque case, l'île la plus proche (en part de son rayon, la côte découpée par le bruit).
  const near = new Float32Array(SIDE * SIDE).fill(9)
  const owner = new Uint8Array(SIDE * SIDE)
  islands.forEach((o, k) => {
    const reach = Math.ceil(o.r * 1.6)
    for (let y = Math.max(0, Math.floor(o.y - reach)); y < Math.min(SIDE, Math.ceil(o.y + reach)); y++) {
      for (let x = Math.max(0, Math.floor(o.x - reach)); x < Math.min(SIDE, Math.ceil(o.x + reach)); x++) {
        const i = y * SIDE + x
        const e = Math.hypot(x - o.x, y - o.y) / (o.r * (0.6 + coast(x, y) * 0.35 + capes(x, y) * 0.45))
        if (e < near[i]) {
          near[i] = e
          owner[i] = k
        }
      }
    }
  })
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const i = y * SIDE + x
      if (near[i] > 1.3) continue
      const o = islands[owner[i]]
      // Plus on s'éloigne du centre de son île, plus c'est de l'eau ; le bruit découpe la côte et la lisière.
      const edge = near[i] + (land(x, y) - 0.5) * 0.3
      // La forêt noire par grandes taches (le bruit), pas en couronne : la prairie comme la forêt vont
      // jusqu'à la côte. Autour du départ, la prairie.
      const home = Math.max(0, 1 - Math.hypot(x - c, y - c) / MEADOW_HOME)
      const dark = patches(x, y) * 0.8 + woods(x, y) * 0.2 - home * 0.7 > o.wild
      const pond = ponds(x, y) > 0.9 && edge < 0.75 && Math.hypot(x - c, y - c) > 12
      let t = T.grass
      if (edge > 0.98) t = T.deep
      else if (edge > 0.9 || pond) t = T.water
      else if (edge > 0.86) t = T.sand
      else if (dark) t = T.forest
      else {
        const v = tone(x, y)
        t = v > 0.66 ? T.light : v < 0.3 ? T.dark : T.grass
      }
      tiles[i] = t
      forest[i] = dark ? 1 : 0
    }
  }
  // Les rivières : d'un point à l'intérieur, elles serpentent vers la mer (en s'écartant du centre de
  // l'île), de plus en plus larges ; jamais au départ.
  for (const o of islands) {
    const count = Math.round((o.r / RIVERS.per) * (0.6 + random() * 0.8))
    for (let k = 0; k < count; k++) {
      let x = o.x + (random() - 0.5) * o.r * 0.7
      let y = o.y + (random() - 0.5) * o.r * 0.7
      if (Math.hypot(x - c, y - c) < MEADOW_HOME || WET.has(tiles[Math.round(y) * SIDE + Math.round(x)])) continue
      let a = Math.atan2(y - o.y, x - o.x) + (random() - 0.5) * 1.2
      const [w0, w1] = RIVERS.width
      const width = w0 + random() * (w1 - w0)
      for (let s = 0; s < o.r * 4; s++) {
        // Elle serpente, ramenée peu à peu vers le large.
        const out = Math.atan2(y - o.y, x - o.x)
        a += (random() - 0.5) * 0.25 + Math.atan2(Math.sin(out - a), Math.cos(out - a)) * 0.03
        x += Math.cos(a)
        y += Math.sin(a)
        if (x < 4 || y < 4 || x > SIDE - 5 || y > SIDE - 5 || Math.hypot(x - c, y - c) < MEADOW_HOME * 0.6) break
        const w = width * (0.6 + Math.min(1, s / o.r) * 0.8)
        let sea = false
        for (let j = Math.floor(y - w); j <= Math.ceil(y + w); j++) {
          for (let i = Math.floor(x - w); i <= Math.ceil(x + w); i++) {
            if (Math.hypot(i - x, j - y) > w) continue
            const t = tiles[j * SIDE + i]
            if (t === T.deep) sea = true
            else tiles[j * SIDE + i] = T.water
          }
        }
        if (sea) break
      }
    }
  }
  // Le sable autour des étangs et des rivières.
  for (let y = 1; y < SIDE - 1; y++) {
    for (let x = 1; x < SIDE - 1; x++) {
      if (WET.has(tiles[y * SIDE + x]) || tiles[y * SIDE + x] === T.sand) continue
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles[(y + dy) * SIDE + x + dx] === T.water)) tiles[y * SIDE + x] = T.sand
    }
  }
  // Des chemins qui partent du centre des îles en serpentant, jusqu'à l'eau (une rivière les coupe).
  for (const o of islands) {
    const paths = o === islands[0] ? 4 : 2 + Math.floor(random() * 2)
    for (let k = 0; k < paths; k++) {
      let x = o.x
      let y = o.y
      let a = (k / paths) * Math.PI * 2 + random() * 0.8
      for (let s = 0; s < o.r * 6; s++) {
        a += (random() - 0.5) * 0.5
        x += Math.cos(a)
        y += Math.sin(a)
        const i = Math.round(y) * SIDE + Math.round(x)
        if (Math.round(x) < 1 || Math.round(y) < 1 || Math.round(x) > SIDE - 2 || Math.round(y) > SIDE - 2 || WET.has(tiles[i])) break
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
          const j = (Math.round(y) + dy) * SIDE + Math.round(x) + dx
          if (!WET.has(tiles[j])) tiles[j] = T.path
        }
      }
    }
  }
  // L'eau peu profonde au bord (on y patauge), profonde au-delà (on y nage) : la mer, les étangs, le
  // milieu des rivières.
  let shore = []
  const far = new Uint8Array(SIDE * SIDE)
  for (let i = 0; i < SIDE * SIDE; i++) if (!WET.has(tiles[i])) { far[i] = 1; shore.push(i) }
  for (let d = 2; d <= SHALLOW + 1 && shore.length; d++) {
    const next = []
    for (const i of shore) {
      const x = i % SIDE
      for (const j of [x > 0 ? i - 1 : -1, x < SIDE - 1 ? i + 1 : -1, i - SIDE, i + SIDE]) {
        if (j < 0 || j >= SIDE * SIDE || far[j]) continue
        far[j] = d
        next.push(j)
      }
    }
    shore = next
  }
  for (let i = 0; i < SIDE * SIDE; i++) {
    if (tiles[i] === T.water && !far[i]) tiles[i] = T.deep
    else if (tiles[i] === T.deep && far[i]) tiles[i] = T.water
  }
  const relief = landform(tiles, random, c)
  return { tiles: tiles.join(''), forest, islands, relief, spawn: { x: c * TILE + TILE / 2, y: c * TILE + TILE / 2 } }
}

// Le relief : pour chaque case, son palier (0 au bord de l'eau, jusqu'à RELIEF.levels à l'intérieur
// des terres) et, en plus (RAMP), si c'est une rampe. De grandes collines (le bruit), qui redescendent
// vers la mer et les rivières ; une plaine autour du départ. Le bord d'un palier plus haut est une
// falaise (voir `cliffs`), sauf aux rampes : chaque palier en a au moins une vers le bas (et les
// chemins passent), si bien que tout endroit de l'île se rejoint depuis le bord de l'eau.
function landform (tiles, random, c) {
  const n = SIDE * SIDE
  const level = new Uint8Array(n)
  const land = (i) => !WET.has(tiles[i])
  // La distance à l'eau, en cases (jusqu'à RELIEF.falloff).
  const dist = new Uint8Array(n).fill(255)
  let queue = []
  for (let i = 0; i < n; i++) if (!land(i)) { dist[i] = 0; queue.push(i) }
  for (let d = 1; d <= RELIEF.falloff && queue.length; d++) {
    const next = []
    for (const i of queue) {
      const x = i % SIDE
      for (const j of [i - 1, i + 1, i - SIDE, i + SIDE]) {
        if (j < 0 || j >= n || Math.abs((j % SIDE) - x) > 1 || dist[j] !== 255) continue
        dist[j] = d
        next.push(j)
      }
    }
    queue = next
  }
  const big = noise(random, SIDE, RELIEF.hills)
  const small = noise(random, SIDE, RELIEF.hills / 3)
  const fine = noise(random, SIDE, RELIEF.hills / 8)
  // Le bruit est déformé par un autre (sinon ses courbes suivent sa grille : des bords tout droits).
  const warpX = noise(random, SIDE, RELIEF.hills / 2)
  const warpY = noise(random, SIDE, RELIEF.hills / 2)
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const i = y * SIDE + x
      if (!land(i)) continue
      const near = Math.min(1, Math.max(0, (Math.min(dist[i], RELIEF.falloff) - 2) / (RELIEF.falloff - 2)))
      const home = Math.max(0, 1 - Math.hypot(x - c, y - c) / (MEADOW_HOME * 0.9))
      const [wx, wy] = [x + (warpX(x, y) - 0.5) * RELIEF.hills * 0.9, y + (warpY(x, y) - 0.5) * RELIEF.hills * 0.9]
      const [cx, cy] = [Math.min(SIDE - 1, Math.max(0, wx)), Math.min(SIDE - 1, Math.max(0, wy))]
      const h = ((big(cx, cy) * 0.62 + small(cx, cy) * 0.28 + fine(cx, cy) * 0.1) - RELIEF.sea) * RELIEF.steep * near * (1 - home)
      level[i] = Math.max(0, Math.min(RELIEF.levels, Math.floor(h * (RELIEF.levels + 1))))
    }
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= SIDE || y >= SIDE ? -1 : y * SIDE + x)
  // Les crêtes et les bandes de deux cases de large, les pointes (une case qui ne tient au palier que
  // par un ou deux côtés) : rabotées, pour des paliers bien ronds.
  for (let pass = 0; pass < 3; pass++) {
    // (Chaque passe regarde le relief d'avant elle : pas d'érosion qui court d'une case à l'autre.)
    const was = level.slice()
    for (let y = 2; y < SIDE - 2; y++) {
      for (let x = 2; x < SIDE - 2; x++) {
        const i = y * SIDE + x
        const l = was[i]
        if (!l) continue
        const low = (j) => was[j] < l
        const held = [i - 1, i + 1, i - SIDE, i + SIDE].filter((j) => !low(j)).length
        // Une bande d'une ou deux cases de large (en long ou en travers).
        const thin = (low(i - 1) && (low(i + 1) || low(i + 2))) || (low(i + 1) && low(i - 2))
        const flat = (low(i - SIDE) && (low(i + SIDE) || low(i + 2 * SIDE))) || (low(i + SIDE) && low(i - 2 * SIDE))
        if (held <= 1 || thin || flat) level[i] = l - 1
      }
    }
  }
  const comp = new Int32Array(n)
  for (let L = RELIEF.levels; L >= 1; L--) {
    comp.fill(-1)
    for (let s = 0; s < n; s++) {
      if (level[s] < L || comp[s] !== -1) continue
      const part = [s]
      comp[s] = s
      for (let k = 0; k < part.length; k++) {
        const i = part[k]
        const x = i % SIDE
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = at(x + dx, Math.floor(i / SIDE) + dy)
          if (j >= 0 && level[j] >= L && comp[j] === -1) { comp[j] = s; part.push(j) }
        }
      }
      if (part.length < RELIEF.smallest) for (const i of part) level[i] = Math.min(level[i], L - 1)
    }
  }
  // Les falaises (le bord d'un palier plus haut), puis les rampes.
  const RAMPED = RELIEF.ramp
  let cliff = cliffs(level, tiles)
  const walk = (i) => i >= 0 && land(i) && !cliff[i]
  const ramp = (i) => { level[i] |= RAMPED; cliff[i] = 0 }
  // Une rampe depuis la case `i` (au bord, sur le palier haut) dans le sens (dx, dy) : elle descend
  // jusqu'à une case où l'on marche (deux falaises qui se suivent : deux marches).
  const stairs = (i, dx, dy) => {
    const way = [i]
    let x = i % SIDE
    let y = Math.floor(i / SIDE)
    for (let k = 0; k < RELIEF.levels; k++) {
      x += dx
      y += dy
      const j = at(x, y)
      if (j < 0 || !land(j)) return false
      if (!cliff[j]) {
        for (const w of way) ramp(w)
        return true
      }
      way.push(j)
    }
    return false
  }
  // Une rampe large : celle-ci, et les cases de falaise d'à côté (en travers), qui descendent pareil.
  const wide = (i, dx, dy) => {
    if (!stairs(i, dx, dy)) return false
    const x = i % SIDE
    const y = Math.floor(i / SIDE)
    for (const s of [-1, 1]) {
      const j = at(x + dy * s, y + dx * s)
      if (j >= 0 && cliff[j] && (level[j] & ~RAMPED) === (level[i] & ~RAMPED)) stairs(j, dx, dy)
    }
    return true
  }
  // Les chemins passent (là où un chemin coupe une falaise : une rampe).
  for (let i = 0; i < n; i++) {
    if (!cliff[i] || tiles[i] !== T.path) continue
    const x = i % SIDE
    const y = Math.floor(i / SIDE)
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const back = at(x - dx, y - dy)
      if (back >= 0 && (level[back] & ~RAMPED) === (level[i] & ~RAMPED) && walk(back) && wide(i, dx, dy)) break
    }
  }
  // Chaque morceau où l'on marche doit toucher le bord de l'eau (un palier 0) : sinon, une rampe de
  // plus (vers le sud de préférence : on voit l'escalier), et d'autres sur les grands paliers.
  for (let round = 0; round < 40; round++) {
    comp.fill(-1)
    const parts = []
    for (let s = 0; s < n; s++) {
      if (!walk(s) || comp[s] !== -1) continue
      const part = [s]
      comp[s] = parts.length
      let low = false
      for (let k = 0; k < part.length; k++) {
        const i = part[k]
        if ((level[i] & ~RAMPED) === 0) low = true
        const x = i % SIDE
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = at(x + dx, Math.floor(i / SIDE) + dy)
          if (walk(j) && comp[j] === -1) { comp[j] = parts.length; part.push(j) }
        }
      }
      parts.push({ tiles: part, low })
    }
    let added = 0
    let lowered = 0
    for (const part of parts) {
      if (part.low && round > 0) continue
      // Les bords de ce morceau : une case de falaise à côté de lui, d'où une rampe peut descendre.
      const edges = []
      for (const i of part.tiles) {
        const x = i % SIDE
        const y = Math.floor(i / SIDE)
        for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
          const e = at(x + dx, y + dy)
          if (e < 0 || !cliff[e] || (level[e] & ~RAMPED) !== (level[i] & ~RAMPED)) continue
          edges.push([e, dx, dy, (dy === 1 ? 2 : 0) + random()])
        }
      }
      edges.sort((a, b) => b[3] - a[3])
      // Un palier qui ne rejoint pas l'eau : au moins une rampe ; un grand : une de plus par tant de cases.
      const want = part.low ? Math.floor(part.tiles.length / RELIEF.rampEvery) : 1 + Math.floor(part.tiles.length / RELIEF.rampEvery)
      const placed = []
      for (const [e, dx, dy] of edges) {
        if (placed.length >= want || (!part.low && part.tiles.length < RELIEF.pocket)) break
        const ex = e % SIDE
        const ey = Math.floor(e / SIDE)
        if (placed.some(([px, py]) => Math.hypot(px - ex, py - ey) < RELIEF.rampRoom)) continue
        if (wide(e, dx, dy)) {
          placed.push([ex, ey])
          added++
        }
      }
      // Aucune rampe possible (une falaise qui tombe dans la mer, des marches trop hautes), ou une toute
      // petite poche : ce palier s'abaisse d'un cran, avec son bord ; on recommence.
      if (!part.low && (!placed.length || part.tiles.length < RELIEF.pocket)) {
        for (const i of part.tiles) if (level[i] & ~RAMPED) level[i]--
        for (const [e] of edges) if (level[e] & ~RAMPED && !(level[e] & RAMPED)) level[e]--
        lowered++
      }
    }
    if (lowered) cliff = cliffs(level, tiles)
    if (!added && !lowered && round > 0) break
  }
  return level
}

// Les falaises : sur un palier plus haut qu'une case voisine (de terre, ou l'eau au pied), sauf les
// rampes. Une case par falaise ; on ne la traverse pas, on n'y bâtit pas.
function cliffs (relief, tiles) {
  const cliff = new Uint8Array(SIDE * SIDE)
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const i = y * SIDE + x
      const l = relief[i] & ~RELIEF.ramp
      if (!l || relief[i] & RELIEF.ramp) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const [nx, ny] = [x + dx, y + dy]
        if (nx < 0 || ny < 0 || nx >= SIDE || ny >= SIDE) continue
        const j = ny * SIDE + nx
        if ((relief[j] & ~RELIEF.ramp) < l || WET.has(tiles[j])) {
          cliff[i] = 1
          break
        }
      }
    }
  }
  return cliff
}

// Ce qui dure d'un redémarrage de floor à l'autre change de forme avec le monde : un état d'une autre
// version est oublié (le monde reprend de sa graine).
const VERSION = 6

class World {
  constructor ({ seed = 1, random = Math.random, now = 0 } = {}) {
    this.seed = seed
    this.random = random
    this.time = now
    // Quand le jour s'est levé (l'heure du jour : `clock`).
    this.dawn = now
    // Le temps qu'il fait : la pluie ou non, jusqu'à quand.
    this.weather = { rain: false, until: now + DRY[0] }
    const gen = seeded(seed)
    const { tiles, forest, spawn, islands, relief } = terrain(gen)
    this.tiles = tiles
    // Le palier de chaque case (et les rampes), et les falaises qu'on ne traverse pas.
    this.relief = relief
    this.cliff = cliffs(relief, tiles)
    this.forest = forest
    this.spawn = spawn
    this.islands = islands
    // La terre qu'il y a, par rapport à celle pour qui les comptes ont été faits (voir LAND_REF).
    let land = 0
    for (let i = 0; i < tiles.length; i++) if (!WET.has(tiles[i])) land++
    this.scale = land / LAND_REF
    this.nextId = 1
    // Les choses du monde, par id (un seul compteur pour tout) : arbres, rochers, buissons, objets
    // par terre, feux, bêtes, joueurs, constructions, carottes plantées.
    this.trees = new Map()
    this.rocks = new Map()
    this.bushes = new Map()
    this.items = new Map()
    this.fires = new Map()
    this.beasts = new Map()
    this.players = new Map()
    this.pieces = new Map()
    this.crops = new Map()
    this.boats = new Map()
    // Les tombes des joueurs morts (ce qu'ils avaient), par id.
    this.tombs = new Map()
    // Les cryptes (voir `raise`), et ce qu'il y a dans leurs donjons (escaliers, coffres, braseros,
    // pointes, os), par id.
    this.crypts = []
    this.props = new Map()
    // Les arbres dont on a arraché la souche (ils viennent de la graine : à retirer au redémarrage).
    this.uprooted = new Set()
    this.arrows = []
    // Les éclairs d'Eikthyr annoncés au sol : x, y, quand ils tombent.
    this.bolts = []
    // Où sont les arbres, les rochers et les feux (ils ne bougent pas).
    this.grid = { trees: new Grid(), rocks: new Grid(), fires: new Grid() }
    // Ce qui occupe chaque case (par son numéro) : les pièces debout, les planchers, les carottes ; et la
    // terre retournée au cultivateur (on n'y plante que là).
    this.solid = new Map()
    this.flat = new Map()
    this.covers = new Map()
    this.cropAt = new Map()
    this.tilled = new Set()
    // L'invocation en cours (Eikthyr arrive à `at`).
    this.summoning = null
    // Ce qui a changé depuis le dernier `changes` (pour l'envoyer à tous), et ce qui s'est passé.
    this.changed = this.fresh()
    this.news = []
    this.plant(gen)
    this.raise()
    this.veins()
    this.litterAt = 0
    this.beastsAt = 0
    this.restock()
    this.repopulate(true)
  }

  fresh () {
    return { trees: new Set(), grown: new Set(), rocks: new Set(), bushes: new Set(), items: new Set(), fires: new Set(), pieces: new Set(), crops: new Set(), boats: new Set(), tombs: new Set(), props: new Set(), tilled: new Set(), gone: new Set() }
  }

  // La case sous un point du monde (l'eau profonde hors de la carte, sauf dans un donjon : ses murs et ses
  // dalles), et son numéro (-1 dehors).
  tile (x, y) {
    if (x >= SIZE || y >= SIZE) {
      const c = this.cryptAt(x, y)
      if (!c) return T.deep
      const t = c.d.tiles[Math.floor((y - c.oy) / TILE) * c.d.side + Math.floor((x - c.ox) / TILE)]
      return t === dungeon.DOOR ? T.crypt : t
    }
    const i = this.cell(x, y)
    return i < 0 ? T.deep : this.tiles[i]
  }

  // La crypte dont le donjon (fait) est sous ce point, s'il y en a une.
  cryptAt (x, y) {
    if (x < SIZE && y < SIZE) return null
    const c = this.crypts[Math.floor((x - CRYPT.band) / CRYPT.stride)]
    if (!c?.d) return null
    const [tx, ty] = [Math.floor((x - c.ox) / TILE), Math.floor((y - c.oy) / TILE)]
    return tx >= 0 && ty >= 0 && tx < c.d.side && ty < c.d.side ? c : null
  }

  // L'espace d'un donjon où est ce point (une salle, un couloir ; -1 une porte, -2 un mur), null dehors.
  zoneAt (x, y) {
    const c = this.cryptAt(x, y)
    return c ? c.d.zones[Math.floor((y - c.oy) / TILE) * c.d.side + Math.floor((x - c.ox) / TILE)] : null
  }

  // Une bête voit-elle ce joueur ? Dehors, oui ; dans un donjon, s'ils sont dans la même salle (ou le
  // même couloir), ou si l'un des deux est dans une porte.
  sees (b, p) {
    const zb = this.zoneAt(b.x, b.y)
    if (zb === null) return true
    const zp = this.zoneAt(p.x, p.y)
    return zp !== null && (zp === zb || zp === -1 || zb === -1)
  }

  cell (x, y) {
    const tx = Math.floor(x / TILE)
    const ty = Math.floor(y / TILE)
    if (tx < 0 || ty < 0 || tx >= SIDE || ty >= SIDE) return -1
    return ty * SIDE + tx
  }

  dry (x, y) {
    return !WET.has(this.tile(x, y))
  }

  // Les mausolées des cryptes, dans la forêt noire (toujours les mêmes pour une graine) : on retire ce qui
  // poussait autour. Leurs donjons se font à la première descente (voir `descend`).
  raise () {
    const random = seeded(this.seed * 7919 + 17)
    this.crypts = []
    let woods = 0
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === T.forest) woods++
    const count = Math.max(1, Math.round(woods / CRYPT.per))
    for (let k = 0; k < count * 2000 && this.crypts.length < count; k++) {
      const tx = 6 + Math.floor(random() * (SIDE - 12))
      const ty = 6 + Math.floor(random() * (SIDE - 12))
      let ok = !this.crypts.some((c) => Math.hypot(c.x / TILE - tx, c.y / TILE - ty) < 40)
      // Sur un même palier, loin de toute falaise.
      const flat = this.relief[ty * SIDE + tx]
      for (let j = ty - 6; j <= ty + 4 && ok; j++) for (let i = tx - 5; i <= tx + 5 && ok; i++) ok = this.tiles[j * SIDE + i] === T.forest && this.relief[j * SIDE + i] === flat && !this.cliff[j * SIDE + i]
      if (!ok) continue
      const n = this.crypts.length
      // Le seuil du mausolée (le bas de sa porte, où l'escalier descend), et où va son donjon.
      this.crypts.push({ id: this.nextId++, x: (tx + 0.5) * TILE, y: ty * TILE, ox: CRYPT.band + n * CRYPT.stride, oy: CRYPT.band, gen: 0, d: null, left: null })
    }
    const near = (o) => this.crypts.some((c) => Math.abs(o.x - c.x) < 64 && o.y > c.y - 80 && o.y < c.y + 40)
    for (const t of [...this.trees.values()]) {
      if (near(t)) {
        this.trees.delete(t.id)
        this.grid.trees.delete(t)
      }
    }
    for (const k of [...this.rocks.values()]) {
      if (near(k)) {
        this.rocks.delete(k.id)
        this.grid.rocks.delete(k)
      }
    }
    for (const b of [...this.bushes.values()]) if (near(b)) this.bushes.delete(b.id)
  }

  // Les gisements d'étain, au bord de l'eau dans la forêt noire (toujours les mêmes pour une graine ;
  // posés après tout le reste, leur tirage à part : les ids d'avant ne bougent pas).
  veins () {
    const random = seeded(this.seed * 6007 + 29)
    const shore = (x, y) => [0, 1, 2, 3, 4, 5, 6, 7].some((a) => [0.5, 1].some((f) => !this.dry(x + Math.cos(a * Math.PI / 4) * TIN.shore * f, y + Math.sin(a * Math.PI / 4) * TIN.shore * f)))
    const wanted = Math.round(TIN.count * this.scale)
    let n = 0
    for (let k = 0; k < wanted * 2000 && n < wanted; k++) {
      const x = Math.round(random() * SIZE)
      const y = Math.round(random() * SIZE)
      if (!this.wild(x, y) || !this.walkable(x, y) || this.tile(x, y) === T.path || !shore(x, y)) continue
      if (this.grid.trees.near(x, y, 30).some((t) => Math.hypot(t.x - x, t.y - y) < 20) || this.grid.rocks.near(x, y, 50).some((k) => Math.hypot(k.x - x, k.y - y) < 40)) continue
      const id = this.nextId++
      const rock = { id, kind: 'tin', x, y, hp: ROCKS.tin.hp, gone: false, back: 0 }
      this.rocks.set(id, rock)
      this.grid.rocks.add(rock)
      n++
    }
  }

  // Devant le mausolée (là où l'on arrive en remontant).
  doorstep (c) {
    return { x: c.x, y: c.y + 14 }
  }

  // Le donjon d'une crypte, tiré de sa graine (une autre à chaque fois qu'il se refait) : ses accessoires,
  // ses squelettes, ses générateurs (des bêtes qui ne bougent pas).
  dig (c) {
    c.gen++
    const plan = dungeon.generate(seeded(this.seed * 31 + c.id * 7919 + c.gen * 104729))
    const at = (tx, ty, dy = 0.8) => ({ x: c.ox + (tx + 0.5) * TILE, y: c.oy + (ty + dy) * TILE })
    c.d = { side: plan.side, tiles: plan.tiles, zones: plan.zones, props: [], solid: [], arrive: at(...plan.entry.arrive, 0.6) }
    c.left = null
    for (const p of plan.props) {
      const { x, y } = at(p.x, p.y)
      if (p.kind === 'spawner') {
        const b = this.spawnBeast('spawner', x, y, BEASTS.spawner.hp, 'crypt')
        Object.assign(b, { crypt: c.id, zone: this.zoneAt(x, y), children: new Set(), next: this.time + 2 })
        continue
      }
      const id = this.nextId++
      const prop = { id, kind: p.kind, crypt: c.id, x, y, open: false, phase: p.phase ?? 0 }
      this.props.set(id, prop)
      c.d.props.push(prop)
      if (PROPS[p.kind].solid) c.d.solid.push(prop)
    }
    for (const s of plan.beasts) {
      const { x, y } = at(s.x, s.y, 0.7)
      const b = this.spawnBeast(s.kind, x, y, BEASTS[s.kind].hp, 'crypt', s.stars ?? null)
      Object.assign(b, { crypt: c.id, zone: this.zoneAt(x, y) })
    }
  }

  // Le donjon se défait : ses bêtes, ses accessoires et ce qui traîne dedans s'en vont.
  undig (c) {
    for (const b of [...this.beasts.values()]) if (b.crypt === c.id) this.beasts.delete(b.id)
    for (const i of [...this.items.values()]) if (this.cryptAt(i.x, i.y) === c) this.remove(this.items, i.id)
    for (const p of c.d.props) this.remove(this.props, p.id)
    c.d = null
    c.left = null
  }

  // Descendre l'escalier d'un mausolée (le jeu le demande quand on avance dans sa porte) : on arrive dans
  // son donjon (fait s'il ne l'était pas).
  descend (id, cryptId) {
    const p = this.players.get(id)
    const c = this.crypts.find((x) => x.id === cryptId)
    if (!p?.alive || p.boat || !c) return 'none'
    if (Math.hypot(c.x - p.x, c.y + 6 - p.y) > USE_REACH) return 'far'
    if (!c.d) this.dig(c)
    Object.assign(p, { x: c.d.arrive.x, y: c.d.arrive.y, moved: this.time, asleep: false })
    this.news.push({ t: 'moved', player: p.id })
    return null
  }

  // Remonter l'escalier (le jeu le demande quand on y monte) : on ressort devant le mausolée.
  ascend (id) {
    const p = this.players.get(id)
    const c = p && this.cryptAt(p.x, p.y)
    if (!p?.alive || !c) return 'none'
    const stairs = c.d.props.find((s) => s.kind === 'stairs')
    if (!stairs || Math.hypot(stairs.x - p.x, stairs.y - p.y) > USE_REACH) return 'far'
    Object.assign(p, { ...this.doorstep(c), moved: this.time })
    this.news.push({ t: 'moved', player: p.id })
    return null
  }

  // Ouvrir un coffre d'un donjon : ce qu'il contient tombe devant lui (une fois ; il se remplit quand le
  // donjon se refait).
  open (id, what) {
    const p = this.players.get(id)
    const box = this.props.get(what)
    const loot = box && PROPS[box.kind].loot
    if (!p?.alive || !loot) return 'none'
    if (box.open) return 'empty'
    if (Math.hypot(box.x - p.x, box.y - p.y) > USE_REACH) return 'far'
    box.open = true
    this.changed.props.add(box.id)
    let got = loot.filter(([, , , chance]) => this.random() < chance)
    if (!got.length) got = [loot[0]]
    got.forEach(([kind, lo, hi], k) => {
      const a = (Math.PI * (k + 0.5)) / got.length
      this.drop(kind, lo + Math.floor(this.random() * (hi - lo + 1)), box.x + Math.cos(a) * 18, box.y + 6 + Math.sin(a) * 10)
    })
    this.news.push({ t: 'fx', k: 'open', id: box.id, x: Math.round(box.x), y: Math.round(box.y) })
    return null
  }

  // Les pointes de ce piège sont-elles sorties ?
  spiky (s) {
    return (this.time + s.phase) % SPIKES.every < SPIKES.up
  }

  // Les donjons : les pointes piquent qui est dessus quand elles sortent ; un donjon vide depuis
  // longtemps (personne, aucune tombe) se défait.
  dungeons (t) {
    for (const c of this.crypts) {
      if (!c.d) continue
      const inside = [...this.players.values()].filter((p) => this.cryptAt(p.x, p.y) === c)
      for (const p of inside) {
        if (!p.alive || t < (p.spiked ?? 0)) continue
        // La case de la pointe : son pied est un peu sous le milieu de la case.
        const spike = c.d.props.find((s) => s.kind === 'spikes' && Math.abs(s.x - p.x) < TILE / 2 && Math.abs(s.y - TILE * 0.3 - p.y) < TILE / 2 && this.spiky(s))
        if (spike) {
          p.spiked = t + SPIKES.again
          this.damage(p, SPIKES.dmg, 'spikes')
        }
      }
      if (inside.length || [...this.tombs.values()].some((x) => this.cryptAt(x.x, x.y) === c)) c.left = null
      else if (c.left === null) c.left = t
      else if (t - c.left > CRYPT.reset) this.undig(c)
    }
  }

  // Le générateur : tant que quelqu'un est dans sa salle, il appelle un squelette (parfois un archer) de
  // temps en temps (qui fonce sur le plus proche).
  summon (b) {
    b.vx = 0
    b.vy = 0
    const t = this.time
    if (t < b.next) return
    const prey = [...this.players.values()].filter((p) => p.alive && dist(p, b) < SPAWNER.reach && this.sees(b, p)).sort((p, q) => dist(p, b) - dist(q, b))[0]
    if (!prey) return
    b.next = t + SPAWNER.every
    b.children = new Set([...b.children].filter((id) => this.beasts.has(id)))
    if (b.children.size >= SPAWNER.max) return
    const a = this.random() * Math.PI * 2
    const [x, y] = [b.x + Math.cos(a) * 20, b.y + 4 + Math.sin(a) * 12]
    if (!this.walkable(x, y)) return
    const kind = this.random() < 0.3 ? 'archer' : 'skeleton'
    const s = this.spawnBeast(kind, x, y, BEASTS[kind].hp, 'crypt')
    Object.assign(s, { crypt: b.crypt, zone: b.zone })
    b.children.add(s.id)
    this.enrage(s, prey)
    this.news.push({ t: 'fx', k: 'raise', id: s.id, x: Math.round(x), y: Math.round(y) })
  }

  // L'heure du jour, en secondes depuis l'aube (la nuit : les NIGHT dernières de DAY).
  clock () {
    return (((this.time - this.dawn) % DAY) + DAY) % DAY
  }

  // La lune de cette nuit (0 : nuit noire, 1 : pleine lune), la même pour tous : tirée de la graine et
  // du numéro de la nuit (l'aube qui suit compte encore pour elle).
  moon () {
    const night = Math.floor((this.time - this.dawn - 120) / DAY)
    return seeded(this.seed * 977 + night * 7919)()
  }

  night () {
    return this.clock() >= DAY - NIGHT
  }

  // Ceux qui dorment, parmi les joueurs en vie.
  sleepers () {
    const alive = [...this.players.values()].filter((p) => p.alive)
    return [alive.filter((p) => p.asleep).length, alive.length]
  }

  // Dans la forêt noire (sinon : la prairie).
  wild (x, y) {
    const i = this.cell(x, y)
    return i >= 0 && this.forest[i] === 1
  }

  // Les forêts et les arbres seuls, les rochers et le cuivre, l'autel, les buissons : toujours les
  // mêmes pour une graine, ids compris (les souches gardées s'y retrouvent).
  plant (gen) {
    const thick = noise(gen, SIZE, 260)
    const near = (x, y, r) => this.grid.trees.near(x, y, r).some((t) => Math.hypot(t.x - x, t.y - y) < r) || this.grid.rocks.near(x, y, r + 10).some((k) => Math.hypot(k.x - x, k.y - y) < r + 10)
    const addTree = (kind, x, y) => {
      // (Pas sur une falaise ni une rampe : rien n'y pousse, on y passe.)
      if (this.steep(x, y)) return
      const id = this.nextId++
      const t = { id, kind, x: Math.round(x), y: Math.round(y), hp: TREES[kind].hp, stump: false, regrow: 0 }
      this.trees.set(id, t)
      this.grid.trees.add(t)
    }
    const trees = Math.round(4200 * this.scale)
    for (let k = 0; k < trees * 40 && this.trees.size < trees; k++) {
      const x = Math.round(gen() * SIZE)
      const y = Math.round(gen() * SIZE)
      const t = this.tile(x, y)
      if (!this.dry(x, y) || !this.dry(x, y - 20) || Math.hypot(x - this.spawn.x, y - this.spawn.y) < 70) continue
      if (t === T.forest) {
        // La forêt noire : des sapins serrés, des pins (pas de bouleaux : ils sont de la prairie).
        if (gen() > 0.8 || near(x, y, 22)) continue
        addTree(gen() < 0.6 ? 'fir' : 'pine', x, y)
      } else if (GRASS.has(t)) {
        const dense = thick(x, y)
        if (gen() > (dense > 0.58 ? 0.9 : 0.06) || near(x, y, 26)) continue
        addTree(gen() < (dense > 0.58 ? 0.25 : 0.5) ? 'birch' : 'beech', x, y)
      }
    }
    const addRock = (kind, count, fits) => {
      const wanted = Math.round(count * this.scale)
      let n = 0
      for (let k = 0; k < wanted * 300 && n < wanted; k++) {
        const x = Math.round(gen() * SIZE)
        const y = Math.round(gen() * SIZE)
        if (!this.dry(x, y) || [[0, 0], [-16, 0], [16, 0], [0, -16], [0, 16]].some(([dx, dy]) => this.steep(x + dx, y + dy)) || this.tile(x, y) === T.path || !fits(x, y) || Math.hypot(x - this.spawn.x, y - this.spawn.y) < 70 || near(x, y, 30)) continue
        const id = this.nextId++
        const rock = { id, kind, x: Math.round(x), y: Math.round(y), hp: ROCKS[kind].hp, gone: false, back: 0 }
        this.rocks.set(id, rock)
        this.grid.rocks.add(rock)
        n++
      }
    }
    addRock('stone', 50, (x, y) => !this.wild(x, y))
    addRock('stone', 35, (x, y) => this.tile(x, y) === T.forest)
    addRock('copper', 30, (x, y) => this.tile(x, y) === T.forest)
    // L'autel d'Eikthyr : dans une clairière au nord du départ (les arbres trop près disparaissent).
    for (let r = 560; r > 100 && !this.altar; r -= 20) {
      for (let a = -0.5; a <= 0.5 && !this.altar; a += 0.1) {
        const x = Math.round(this.spawn.x + Math.sin(a) * r)
        const y = Math.round(this.spawn.y - Math.cos(a) * r)
        const ok = [[0, 0], [-60, 0], [60, 0], [0, -60], [0, 60]].every(([dx, dy]) => (GRASS.has(this.tile(x + dx, y + dy)) || this.tile(x + dx, y + dy) === T.path) && !this.steep(x + dx, y + dy))
        if (ok) this.altar = { x, y }
      }
    }
    this.altar ??= { x: this.spawn.x, y: this.spawn.y - 140 }
    for (const t of [...this.trees.values()]) {
      if (Math.hypot(t.x - this.altar.x, t.y - this.altar.y) < 90) {
        this.trees.delete(t.id)
        this.grid.trees.delete(t)
      }
    }
    for (const k of [...this.rocks.values()]) {
      if (Math.hypot(k.x - this.altar.x, k.y - this.altar.y) < 90) {
        this.rocks.delete(k.id)
        this.grid.rocks.delete(k)
      }
    }
    // Les framboisiers en lisière, sur l'herbe ; les myrtilles dans la forêt noire.
    const placed = new Grid()
    const addBushes = (kind, fits, room) => {
      const wanted = Math.round(BUSHES[kind].count * this.scale)
      let n = 0
      for (let k = 0; k < wanted * 200 && n < wanted; k++) {
        const x = Math.round(gen() * SIZE)
        const y = Math.round(gen() * SIZE)
        if (!fits(x, y) || this.steep(x, y) || near(x, y, 22)) continue
        if (placed.near(x, y, room).some((b) => Math.hypot(b.x - x, b.y - y) < room) || Math.hypot(x - this.altar.x, y - this.altar.y) < 90) continue
        const id = this.nextId++
        const bush = { id, kind, x, y, ripe: true, back: 0 }
        this.bushes.set(id, bush)
        placed.add(bush)
        n++
      }
    }
    addBushes('raspberry', (x, y) => GRASS.has(this.tile(x, y)) && near(x, y, 70), 40)
    addBushes('blueberry', (x, y) => this.tile(x, y) === T.forest, 36)
  }

  // Un point libre (sec, loin des arbres et rochers), au hasard, à plus de `far` des joueurs, où `fits`.
  freeSpot (far = 0, tries = 60, fits = () => true) {
    for (let k = 0; k < tries; k++) {
      const x = Math.round(40 + this.random() * (SIZE - 80))
      const y = Math.round(40 + this.random() * (SIZE - 80))
      if (!this.walkable(x, y) || !fits(x, y)) continue
      if (far && [...this.players.values()].some((p) => p.alive && Math.hypot(p.x - x, p.y - y) < far)) continue
      return { x, y }
    }
    return null
  }

  // La pièce debout (mur, porte, établi...) sur la case de ce point.
  solidAt (x, y) {
    return this.solid.get(this.cell(x, y)) ?? null
  }

  // On peut se tenir là : la terre ferme, pas dans un tronc, un rocher, l'autel, un mausolée, un feu, un
  // mur (d'une base, d'un donjon), une porte fermée, un coffre ou un brasero d'un donjon.
  walkable (x, y) {
    if (!this.dry(x, y) && !this.bridged(x, y)) return false
    const i = this.cell(x, y)
    if (i >= 0 && this.cliff[i]) return false
    for (const dx of [-4, 0, 4]) if (this.tile(x + dx, y) === T.cryptwall) return false
    const c = this.cryptAt(x, y)
    if (c) return !c.d.solid.some((p) => Math.abs(p.x - x) < PROPS[p.kind].solid[0] && y > p.y - PROPS[p.kind].solid[1] && y < p.y + 2)
    for (const m of this.crypts) {
      const door = Math.abs(x - m.x) < CRYPT.door && y > m.y - CRYPT.deep
      if (Math.abs(x - m.x) < CRYPT.w && y > m.y - CRYPT.h && y < m.y - 2 && !door) return false
    }
    for (const t of this.grid.trees.near(x, y, 10)) if (!t.stump && Math.abs(t.x - x) < 8 && Math.abs(t.y - y) < 6) return false
    for (const k of this.grid.rocks.near(x, y, 18)) if (!k.gone && Math.abs(k.x - x) < (k.kind === 'stone' ? 13 : 16) && Math.abs(k.y - y) < 7) return false
    if (Math.abs(this.altar.x - x) < 18 && Math.abs(this.altar.y - y) < 8) return false
    for (const f of this.grid.fires.near(x, y, 10)) if (Math.hypot(f.x - x, f.y - y) < 10) return false
    for (const dx of [-4, 0, 4]) {
      const p = this.solidAt(x + dx, y)
      if (p && !(p.kind === 'door' && p.open)) return false
    }
    return true
  }

  // Où va un bateau : sur l'eau, la coque (de part et d'autre) aussi.
  sailable (x, y) {
    return [-12, 0, 12].every((dx) => this.cell(x + dx, y) >= 0 && !this.dry(x + dx, y) && !this.bridged(x + dx, y))
  }

  // Une falaise ou une rampe sous ce point (rien n'y pousse, on n'y bâtit pas).
  steep (x, y) {
    const i = this.cell(x, y)
    return i >= 0 && (this.cliff[i] === 1 || (this.relief[i] & RELIEF.ramp) !== 0)
  }

  // Un pont sur la case de ce point.
  bridged (x, y) {
    return this.flat.get(this.cell(x, y))?.kind === 'bridge'
  }

  // On nage là : dans l'eau profonde (douce ou de mer), sans pont, hors d'un donjon.
  swimmable (x, y) {
    return this.cell(x, y) >= 0 && this.tile(x, y) === T.deep && !this.bridged(x, y) && !this.cryptAt(x, y)
  }

  // On patauge là : dans l'eau peu profonde, près de la rive (on y marche, sans nager ni se noyer).
  wadeable (x, y) {
    return this.cell(x, y) >= 0 && this.tile(x, y) === T.water && !this.bridged(x, y) && !this.cryptAt(x, y)
  }

  // Le joueur nage (ni à bord, ni sur un pont).
  swimming (p) {
    return !p.boat && this.swimmable(p.x, p.y)
  }

  // Le jeu dit que le nageur n'a plus d'endurance : il se noie un peu (pas plus d'une fois par seconde,
  // l'armure n'y fait rien).
  drown (id) {
    const p = this.players.get(id)
    if (!p?.alive || !this.swimming(p) || this.time - (p.drowned ?? -99) < 0.9) return false
    p.drowned = this.time
    p.hp -= DROWN
    p.hurt = this.time
    this.news.push({ t: 'fx', k: 'hurt', id: p.id, dmg: DROWN, x: Math.round(p.x), y: Math.round(p.y) })
    if (p.hp <= 0) this.die(p, null)
    return true
  }

  // Près d'un établi (les bêtes n'y reviennent pas, on y bâtit).
  nearBench (x, y, r = BENCH_RANGE) {
    return [...this.pieces.values()].some((p) => p.kind === 'workbench' && Math.hypot(p.x - x, p.y - y) < r)
  }

  // Remet par terre ce que la nature donne, qu'il y en ait toujours : branches et pierres partout,
  // silex sur les plages, champignons sous les arbres, carottes sauvages dans la forêt noire.
  restock () {
    const fits = {
      flint: (x, y) => this.tile(x, y) === T.sand,
      mushroom: (x, y) => SOIL.has(this.tile(x, y)) && this.grid.trees.near(x, y, 45).some((t) => !t.stump && Math.hypot(t.x - x, t.y - y) < 45),
      wildcarrot: (x, y) => this.tile(x, y) === T.forest
    }
    for (const kind of Object.keys(LITTER)) {
      let n = [...this.items.values()].filter((i) => i.kind === kind && i.wild).length
      const wanted = Math.round(LITTER[kind] * this.scale)
      while (n < wanted) {
        const at = this.freeSpot(0, fits[kind] ? 2000 : 300, fits[kind])
        if (!at) break
        this.drop(kind, 1, at.x, at.y, { wild: true })
        n++
      }
    }
  }

  // Des bêtes jusqu'au compte (au départ partout, ensuite loin des joueurs), chacune dans son pays,
  // jamais près d'un établi.
  repopulate (start = false) {
    const home = {
      meadow: (x, y) => !this.wild(x, y) && !this.nearBench(x, y, NO_SPAWN),
      forest: (x, y) => this.tile(x, y) === T.forest && !this.nearBench(x, y, NO_SPAWN)
    }
    for (const [kind, b] of Object.entries(BEASTS)) {
      for (const [biome, count] of Object.entries(b.count)) {
        const wanted = Math.round(count * this.scale)
        if (!start && this.time < (this.backAt?.[kind] ?? 0)) continue
        let n = [...this.beasts.values()].filter((x) => x.kind === kind && x.home === biome).length
        for (let k = start ? Infinity : Math.max(1, Math.ceil(wanted * BEASTS_BACK)); n < wanted && k > 0; k--) {
          const at = this.freeSpot(start ? 0 : BEAST_FAR, 200, home[biome])
          if (!at) break
          this.spawnBeast(kind, at.x, at.y, b.hp, biome)
          n++
        }
      }
    }
    // Les gardes des mausolées : autour de la porte, loin des joueurs (sauf au départ) ; un garde tué ne
    // revient qu'au bout de `CRYPT.guardsBack`, et pas tant que quelqu'un est dans le donjon.
    const far = (x, y) => start || ![...this.players.values()].some((p) => p.alive && Math.hypot(p.x - x, p.y - y) < BEAST_FAR)
    for (const c of this.crypts) {
      if (!start && (this.time < (c.guardsAt ?? 0) || [...this.players.values()].some((p) => this.cryptAt(p.x, p.y) === c))) continue
      let n = [...this.beasts.values()].filter((b) => b.guards === c.id).length
      for (let k = 0; k < 60 && n < CRYPT.guards; k++) {
        const a = this.random() * Math.PI * 2
        const r = 45 + this.random() * 50
        const [x, y] = [Math.round(c.x + Math.cos(a) * r), Math.round(c.y + 10 + Math.sin(a) * r * 0.7)]
        if (!this.walkable(x, y) || !far(x, y) || this.nearBench(x, y, NO_SPAWN)) continue
        const kind = this.random() < CRYPT.archers ? 'archer' : 'skeleton'
        const b = this.spawnBeast(kind, x, y, BEASTS[kind].hp, 'mausoleum')
        Object.assign(b, { guards: c.id, post: { x: c.x, y: c.y + 10 } })
        n++
      }
    }
  }

  // Une bête arrive (ses étoiles tirées selon son pays et l'heure, sauf si elles sont données).
  spawnBeast (kind, x, y, hp, home = null, stars = null) {
    const id = this.nextId++
    stars ??= this.luck(kind, home)
    hp *= STARS.hp[stars]
    const b = { id, kind, home, stars, den: { x, y }, x, y, hp, max: hp, d: 2, state: 'idle', until: this.random() * 3, vx: 0, vy: 0, target: null, flee: null, bit: -99, hurt: -99, stun: -99 }
    if (kind === 'skeleton' && this.random() < SHIELDED.share) b.shield = true
    this.beasts.set(id, b)
    return b
  }

  // Combien d'étoiles a une bête qui arrive : aucune pour Eikthyr et les générateurs.
  luck (kind, home) {
    const chance = STARS.chance[home]
    if (!chance || kind === 'eikthyr' || BEASTS[kind]?.fixed) return 0
    const k = this.night() ? 2 : 1
    const r = this.random()
    return r < chance[1] * k ? 2 : r < (chance[0] + chance[1]) * k ? 1 : 0
  }

  // Ce que les étoiles d'une bête ajoutent à ses coups.
  might (b) {
    return STARS.dmg[b.stars ?? 0]
  }

  // Une bête est-elle dans son pays (la prairie, la forêt noire) en (x, y) ?
  homeAt (b, x, y) {
    if (b.home === 'forest') return this.tile(x, y) === T.forest
    if (b.home === 'meadow') return !this.wild(x, y)
    // Dans un donjon : sa salle ; un garde : les abords de son mausolée.
    if (b.home === 'crypt') return this.zoneAt(x, y) === b.zone
    if (b.home === 'mausoleum') return Math.hypot(x - b.post.x, y - b.post.y) < CRYPT.post
    return true
  }

  boss () {
    return [...this.beasts.values()].find((b) => b.kind === 'eikthyr') ?? null
  }

  drop (kind, n, x, y, { wild = false } = {}) {
    const id = this.nextId++
    const item = { id, kind, n, x: Math.round(x), y: Math.round(y), wild, until: wild ? Infinity : this.time + DROP_TIME }
    this.items.set(id, item)
    this.changed.items.add(id)
    return item
  }

  remove (map, id) {
    map.delete(id)
    this.changed.gone.add(id)
    for (const set of [this.changed.trees, this.changed.items, this.changed.fires, this.changed.pieces, this.changed.crops, this.changed.boats, this.changed.tombs, this.changed.props]) set.delete(id)
  }

  // Un joueur arrive (avec ce qu'il avait gardé : position, santé, inventaire, ce qu'il tient, porte,
  // les repas en cours, son lit).
  join (name, { account = null, saved = null } = {}) {
    const id = this.nextId++
    const fresh = saved?.v === VERSION
    // Parti dans un donjon : il revient devant le mausolée (le donjon se refait).
    const below = saved && (saved.x >= SIZE || saved.y >= SIZE) && this.crypts[Math.floor((saved.x - CRYPT.band) / CRYPT.stride)]
    const at = below ? this.doorstep(below) : fresh && saved && this.walkable(saved.x, saved.y) ? saved : this.spawn
    const inv = { ...(saved?.inv ?? {}) }
    const worn = {}
    for (const [slot, kind] of Object.entries(saved?.worn ?? {})) if (WEAR[kind]?.slot === slot && inv[kind]) worn[slot] = kind
    const food = (saved?.food ?? []).filter(([kind, left]) => FOODS[kind] && left > 0).slice(0, MEALS).map(([kind, left]) => ({ kind, until: this.time + left }))
    const p = {
      id, name, account,
      x: at.x, y: at.y, d: 0, m: 0,
      inv,
      held: saved?.held && inv[saved.held] && TOOLS_HELD.has(saved.held) ? saved.held : null,
      worn,
      food,
      // L'ordre des cases de l'inventaire (le joueur les range ; la première rangée est sa barre).
      order: arrange([], saved?.order),
      // Le lit où il revient après sa mort (x, y), s'il en a un.
      bed: fresh && saved?.bed ? { x: saved.bed.x, y: saved.bed.y } : null,
      // La qualité de ses outils, armes et vêtements (1 si rien n'est dit).
      quality: Object.fromEntries(Object.entries(saved?.quality ?? {}).filter(([k, q]) => UPGRADES[k] && inv[k] && q > 1 && q <= QUALITY_MAX)),
      alive: true,
      // Le dernier geste (sorte, quand) : les autres le voient.
      act: null, actAt: -99,
      ready: 0, hurt: -99, moved: this.time,
      // Endormi dans son lit (la nuit passe quand tous dorment) ; bouger ou être frappé réveille.
      asleep: false,
      // Le bateau où il est (son id), sinon null.
      boat: null,
      // Le bouclier levé depuis… (null : baissé).
      guard: null
    }
    p.hp = Math.min(saved?.hp > 0 ? saved.hp : BASE_HP, this.maxHp(p))
    this.players.set(id, p)
    return p
  }

  leave (id) {
    const p = this.players.get(id)
    if (p) this.ashore(p)
    this.players.delete(id)
  }

  // Le joueur n'est plus à bord (parti, mort) : le bateau reste où il est.
  ashore (p) {
    const boat = p.boat && this.boats.get(p.boat)
    if (boat) Object.assign(boat, { x: Math.round(p.x), y: Math.round(p.y), d: p.d, rider: null })
    if (boat) this.changed.boats.add(boat.id)
    if (p.boat) this.news.push({ t: 'inv', player: p.id })
    p.boat = null
  }

  maxHp (p) {
    return BASE_HP + p.food.reduce((s, f) => s + FOODS[f.kind].hp, 0)
  }

  maxStamina (p) {
    return BASE_STAMINA + p.food.reduce((s, f) => s + FOODS[f.kind].stamina, 0)
  }

  armor (p) {
    return Object.values(p.worn).reduce((s, k) => s + (WEAR[k] ? WEAR[k].armor + QUALITY_ARMOR * (this.quality(p, k) - 1) : 0), 0)
  }

  quality (p, kind) {
    return p.quality?.[kind] ?? 1
  }

  // Ce que fait ce qu'il tient, selon sa qualité : les dégâts, la coupe, la pioche, la flèche plus forts.
  tool (p) {
    const base = TOOLS[p.held ?? 'hand'] ?? TOOLS.hand
    const k = 1 + QUALITY_DMG * (this.quality(p, p.held) - 1)
    if (k === 1) return base
    const up = (v) => (v ? Math.round(v * k * 10) / 10 : v)
    return { ...base, dmg: up(base.dmg), chop: up(base.chop), mine: up(base.mine), arrow: up(base.arrow) }
  }

  // Ce qu'on garde d'un joueur entre deux parties.
  save (p) {
    return {
      v: VERSION,
      x: Math.round(p.x),
      y: Math.round(p.y),
      hp: Math.round(p.alive ? p.hp : BASE_HP),
      inv: p.inv,
      held: p.held,
      worn: p.worn,
      food: p.alive ? p.food.map((f) => [f.kind, Math.round(f.until - this.time)]) : [],
      order: p.order,
      bed: p.bed,
      quality: p.quality
    }
  }

  // La position envoyée par le jeu (il bouge le joueur lui-même, pour réagir tout de suite) : refusée
  // si elle va trop vite ou tombe dans l'eau, un arbre... (false : le jeu remet le joueur où floor le voit).
  move (id, x, y, d, m) {
    const p = this.players.get(id)
    if (!p?.alive || !Number.isFinite(x) || !Number.isFinite(y)) return false
    const dt = Math.max(this.time - p.moved, 0.05)
    const far = Math.hypot(x - p.x, y - p.y)
    p.d = [0, 1, 2, 3].includes(d) ? d : p.d
    p.m = [0, 1, 2].includes(m) ? m : 0
    const speed = this.time - (p.rolled ?? -99) < 0.6 ? COMBAT.rollSpeed : RUN
    // Trop chargé : on ne bouge plus (sauf à bord).
    if (!p.boat && far > 2 && this.load(p) >= CARRY) return false
    if (far > speed * dt * MOVE_SLACK + 4 || !(p.boat ? this.sailable(x, y) : this.walkable(x, y) || this.wadeable(x, y) || this.swimmable(x, y))) return false
    if (far > 1) p.asleep = false
    p.x = x
    p.y = y
    p.moved = this.time
    return true
  }

  // Sauter une falaise, en descendant (comme on saute d'un rebord) : du palier où l'on est jusqu'en
  // (x, y), plus bas, à pas plus de JUMP cases, rien que de la falaise entre les deux. false : refusé.
  jump (id, x, y) {
    const p = this.players.get(id)
    if (!p?.alive || p.boat || !Number.isFinite(x) || !Number.isFinite(y) || this.swimming(p)) return false
    const from = this.cell(p.x, p.y)
    const to = this.cell(x, y)
    if (from < 0 || to < 0 || this.cliff[from] || !this.walkable(x, y)) return false
    const top = this.relief[from] & ~RELIEF.ramp
    const low = this.relief[to] & ~RELIEF.ramp
    const far = Math.hypot(x - p.x, y - p.y)
    if (low >= top || far > JUMP * TILE) return false
    for (let k = 1; k < far / 4; k++) {
      const [sx, sy] = [p.x + ((x - p.x) * k * 4) / far, p.y + ((y - p.y) * k * 4) / far]
      const i = this.cell(sx, sy)
      const l = this.relief[i] & ~RELIEF.ramp
      if (l > top || (!this.cliff[i] && !this.walkable(sx, sy))) return false
    }
    Object.assign(p, { x, y, moved: this.time })
    this.news.push({ t: 'fx', k: 'jump', id: p.id, player: p.id, x: Math.round(x), y: Math.round(y) })
    return true
  }

  // Il reste de la place pour une chose de plus de cette sorte dans le sac.
  room (p, kind) {
    return this.fit(p, kind, 1) > 0
  }

  // Combien de choses de cette sorte tiennent encore dans le sac (jusqu'à `n`) : de la place dans sa
  // dernière pile, ou des cases libres.
  fit (p, kind, n) {
    const have = this.bagged(p, kind)
    const stack = stackOf(kind)
    const free = (SLOTS - this.bag(p)) * stack + (have ? (stack - (have % stack || stack)) : 0)
    return Math.max(0, Math.min(n, free))
  }

  // Combien de choses de cette sorte sont dans le sac (ce qu'on porte a ses propres places).
  bagged (p, kind) {
    const n = p.inv[kind] ?? 0
    return Object.values(p.worn).includes(kind) ? n - 1 : n
  }

  // Les cases prises dans le sac : une par pile.
  bag (p) {
    return Object.keys(p.inv).reduce((sum, k) => sum + Math.ceil(Math.max(0, this.bagged(p, k)) / stackOf(k)), 0)
  }

  // Ce que porte le joueur (tout ce qu'il a, sur lui comme dans le sac).
  load (p) {
    return Object.entries(p.inv).reduce((sum, [k, n]) => sum + n * weightOf(k), 0)
  }

  // Jeter par terre ce qu'on a de cette sorte (toute la pile), devant soi : n'importe qui peut le
  // ramasser ; il finit par disparaître (DROP_TIME).
  discard (id, kind) {
    const p = this.players.get(id)
    const n = p?.alive && typeof kind === 'string' ? p.inv[kind] ?? 0 : 0
    if (!n || !this.take(p, kind, n)) return false
    // (Assez loin pour que le jeu ne le ramasse pas aussitôt en passant dessus.)
    const [dx, dy] = [[0, 26], [0, -26], [-26, 0], [26, 0]][p.d] ?? [0, 26]
    this.drop(kind, n, p.x + dx, p.y + dy)
    return true
  }

  give (p, kind, n) {
    p.inv[kind] = (p.inv[kind] ?? 0) + n
    this.news.push({ t: 'inv', player: p.id })
  }

  take (p, kind, n) {
    if ((p.inv[kind] ?? 0) < n) return false
    p.inv[kind] -= n
    if (!p.inv[kind]) {
      delete p.inv[kind]
      delete p.quality[kind]
      if (p.held === kind) p.held = null
      for (const [slot, k] of Object.entries(p.worn)) if (k === kind) delete p.worn[slot]
    }
    this.news.push({ t: 'inv', player: p.id })
    return true
  }

  has (p, need) {
    return Object.entries(need).every(([k, n]) => (p.inv[k] ?? 0) >= n)
  }

  pay (p, need) {
    for (const [k, n] of Object.entries(need)) this.take(p, k, n)
  }

  // Le joueur range son inventaire : ce qui va dans chaque case (null : vide).
  arrange (id, order) {
    const p = this.players.get(id)
    if (p) p.order = arrange(p.order, order)
  }

  // Tenir un outil ou une arme (null : les mains nues).
  hold (id, kind) {
    const p = this.players.get(id)
    if (!p) return
    p.held = TOOLS_HELD.has(kind) && p.inv[kind] ? kind : null
    if (TOOLS[p.held]?.both) p.guard = null
    this.news.push({ t: 'inv', player: p.id })
  }

  // Lever le bouclier (on) ou le baisser : il faut en porter un, et pas d'arc en main ni de bateau.
  block (id, on) {
    const p = this.players.get(id)
    if (!p) return
    const can = p.alive && !p.boat && SHIELDS[p.worn.shield] && !TOOLS[p.held]?.both
    if (!on || !can) p.guard = null
    else if (p.guard === null) p.guard = this.time
  }

  // Ce que le bouclier porté arrête (selon sa qualité), et sa parade (0 : il ne pare pas).
  shield (p) {
    const s = SHIELDS[p.worn.shield]
    if (!s) return null
    return { block: s.block + SHIELD_QUALITY * (this.quality(p, p.worn.shield) - 1), parry: s.parry }
  }

  // Mettre ou enlever un vêtement.
  wear (id, kind) {
    const p = this.players.get(id)
    const w = WEAR[kind]
    if (!p || !w || !p.inv[kind]) return
    if (p.worn[w.slot] === kind) {
      // Retiré, il revient dans le sac : il y faut une case.
      delete p.worn[w.slot]
      if (this.bag(p) > SLOTS) {
        p.worn[w.slot] = kind
        return this.news.push({ t: 'fx', k: 'full', player: p.id, x: Math.round(p.x), y: Math.round(p.y) })
      }
    } else p.worn[w.slot] = kind
    this.news.push({ t: 'inv', player: p.id })
  }

  // Le point devant le joueur, où porte un coup.
  front (p, reach) {
    const [dx, dy] = [[0, 1], [0, -1], [-1, 0], [1, 0]][p.d]
    return { x: p.x + dx * reach * 0.6, y: p.y - 8 + dy * reach * 0.6 }
  }

  // Un coup avec ce qu'on tient : la bête la plus proche devant, sinon le rocher (à la pioche), sinon
  // l'arbre (à la hache, assez dure pour lui). Lourd (`heavy`), il frappe plus fort (la lance, elle, se
  // lance) ; sinon il continue la série (voir COMBAT).
  hit (id, heavy = false) {
    const p = this.players.get(id)
    if (!p?.alive || this.time < p.ready - HIT_SLACK || this.swimming(p)) return
    p.guard = null
    const tool = this.tool(p)
    if (heavy && p.held === 'spear') return this.throw(p, tool)
    const reach = tool.reach
    // La série (contre une bête) : le coup suit le précédent de près ; le troisième, le coup final, laisse
    // un peu plus de temps avant le suivant.
    const chained = !heavy && this.time - p.ready <= COMBAT.chain && this.time - (p.struck ?? -99) <= tool.every * 1.3 + COMBAT.chain
    p.ready = this.time + tool.every * (heavy ? 1.6 : 1)
    p.act = heavy ? 'heavy' : 'hit'
    p.actAt = this.time
    const at = this.front(p, reach)
    const beast = [...this.beasts.values()].filter((b) => Math.hypot(b.x - at.x, b.y - 8 * sizeOf(b) - at.y) < reach * 0.8 * sizeOf(b)).sort((a, b) => dist(a, at) - dist(b, at))[0]
    if (beast) {
      p.struck = this.time
      p.combo = chained ? ((p.combo ?? 0) + 1) % 3 : 0
      const final = !heavy && p.combo === 2
      if (final) p.ready += tool.every * 0.3
      return this.smite(beast, p, tool, heavy ? 'heavy' : final ? 'final' : null)
    }
    p.combo = 0
    const rock = this.grid.rocks.near(at.x, at.y, reach + 6).filter((k) => !k.gone && Math.hypot(k.x - at.x, k.y - 6 - at.y) < reach * 0.8 + (k.kind === 'stone' ? 0 : 6)).sort((a, b) => dist(a, at) - dist(b, at))[0]
    if (rock) {
      if (!tool.mine) return this.news.push({ t: 'fx', k: 'nomine', player: p.id, id: rock.id })
      rock.hp -= tool.mine
      this.news.push({ t: 'fx', k: 'mine', id: rock.id, x: rock.x, y: rock.y })
      if (rock.hp <= 0) this.crush(rock)
      return
    }
    // Un arbre debout d'abord, sinon une souche (n'importe quelle hache l'arrache).
    const trees = this.grid.trees.near(at.x, at.y - 6, reach).filter((t) => Math.hypot(t.x - at.x, t.y - 6 - at.y) < reach * 0.7).sort((a, b) => dist(a, at) - dist(b, at))
    const tree = trees.find((t) => !t.stump) ?? trees[0]
    if (!tree) return
    if (!tool.chop || (!tree.stump && tool.tier < TREES[tree.kind].tier)) {
      this.news.push({ t: 'fx', k: 'nochop', player: p.id, id: tree.id, kind: tool.chop ? 'bronzeaxe' : 'axe' })
      return
    }
    tree.hp -= tool.chop
    this.news.push({ t: 'fx', k: 'chop', id: tree.id, x: tree.x, y: tree.y })
    if (tree.hp <= 0) {
      if (tree.stump) this.uproot(tree)
      else this.fell(tree, p)
    }
  }

  // Un coup qui porte sur une bête : la série, l'attaque lourde, la surprise, le bouclier du squelette.
  smite (beast, p, tool, blow) {
    let dmg = tool.dmg
    let how = { ...tool, blow }
    const big = sizeOf(beast) > 1.5
    // Le bouclier du squelette, de face : il arrête presque tout ; l'attaque lourde le brise.
    if (beast.shield && this.time >= beast.stun && this.facingBeast(beast, p)) {
      if (blow !== 'heavy') {
        this.news.push({ t: 'fx', k: 'guard', id: beast.id, player: p.id, x: Math.round(beast.x), y: Math.round(beast.y) })
        dmg *= SHIELDED.through
        how = { ...how, blow: 'guarded' }
      }
    } else if (beast.kind !== 'eikthyr' && !(beast.state === 'rage' && beast.target === p.id) && !this.facingBeast(beast, p)) {
      // Dans son dos, et elle ne s'en prenait pas à vous : un coup en traître.
      dmg *= p.held === 'knife' ? COMBAT.sneakKnife : COMBAT.sneak
      how = { ...how, blow: blow ?? 'sneak' }
    }
    if (blow === 'heavy') dmg *= COMBAT.heavy
    if (blow === 'final') dmg *= COMBAT.finisher
    const alive = this.hurt(beast, dmg, p, how)
    if (!this.beasts.has(beast.id) || alive === false) return
    // Repoussée, et (l'attaque lourde, le coup final à la massue) elle chancelle.
    const push = blow === 'heavy' ? COMBAT.heavyPush : blow === 'final' ? COMBAT.push : 0
    if (push && beast.kind !== 'eikthyr') this.shove(beast, p, big ? push / 3 : push)
    if (!big && beast.kind !== 'eikthyr' && !BEASTS[beast.kind]?.fixed && (blow === 'heavy' || (blow === 'final' && tool.blunt))) {
      beast.stun = this.time + COMBAT.stagger
      beast.swing = null
      beast.rush = null
      this.news.push({ t: 'fx', k: 'stagger', id: beast.id, x: Math.round(beast.x), y: Math.round(beast.y) })
    }
  }

  // La bête regarde-t-elle vers ce joueur (son bouclier entre eux) ?
  facingBeast (b, p) {
    return b.d === 2 ? p.x < b.x + 4 : b.d === 3 ? p.x > b.x - 4 : true
  }

  // Repousser une bête loin de `from`, de tant de pixels (jusqu'à ce qui l'arrête).
  shove (b, from, push) {
    const len = Math.max(dist(b, from), 1)
    const [ux, uy] = [(b.x - from.x) / len, (b.y - from.y) / len]
    for (let k = 0; k < push; k += 2) {
      const [x, y] = [b.x + ux * 2, b.y + uy * 2]
      if (!this.walkable(x, y)) break
      b.x = x
      b.y = y
    }
  }

  // Lancer sa lance (l'attaque lourde, lance en main) : elle vole devant soi, et tombe là où elle s'arrête.
  throw (p, tool) {
    const [dx, dy] = [[0, 1], [0, -1], [-1, 0], [1, 0]][p.d]
    p.inv.spear -= 1
    if (!p.inv.spear) {
      // (Sa qualité reste notée : on la retrouve en la ramassant.)
      delete p.inv.spear
      p.held = null
    }
    this.news.push({ t: 'inv', player: p.id })
    p.ready = this.time + tool.every * 1.6
    p.act = 'shoot'
    p.actAt = this.time
    this.arrows.push({ x: p.x, y: p.y - 14, vx: dx * SPEAR.speed, vy: dy * SPEAR.speed, left: SPEAR.range, by: p.id, dmg: tool.dmg * SPEAR.dmg, spear: true })
  }

  // La roulade : quelques instants où aucun coup ne porte (le jeu tient l'endurance).
  roll (id) {
    const p = this.players.get(id)
    if (!p?.alive || p.boat || this.swimming(p) || this.time - (p.rolled ?? -99) < COMBAT.roll) return
    p.rolled = this.time
    p.guard = null
    p.act = 'roll'
    p.actAt = this.time
  }

  // L'arbre tombe : ce qu'il donne par terre (du côté opposé au bûcheron), une souche qui reste.
  fell (tree, by) {
    tree.stump = true
    tree.hp = STUMP_HP
    this.changed.trees.add(tree.id)
    const side = by && by.x > tree.x ? -1 : 1
    let k = 0
    for (const [kind, n, chance] of TREES[tree.kind].loot) {
      if (this.random() >= chance) continue
      for (let i = 0; i < n; i++, k++) {
        this.drop(kind, 1, tree.x + side * (14 + k * 9) + (this.random() - 0.5) * 6, tree.y - 2 + (this.random() - 0.5) * 10)
      }
    }
    this.news.push({ t: 'fx', k: 'fell', id: tree.id, x: tree.x, y: tree.y, side })
  }

  // La souche arrachée : une bûche, et plus rien là (pour de bon).
  uproot (tree) {
    this.remove(this.trees, tree.id)
    this.grid.trees.delete(tree)
    if (!tree.grown) this.uprooted.add(tree.id)
    this.drop('wood', 1, tree.x, tree.y)
    if (this.random() < SEED_CHANCE) this.drop(SEEDS[tree.kind], 1, tree.x + 8, tree.y + 4)
    this.news.push({ t: 'fx', k: 'uproot', id: tree.id, x: tree.x, y: tree.y })
  }

  // Le rocher cède : ce qu'il donne autour (pierres et silex, ou minerai de cuivre) ; il reviendra.
  crush (rock) {
    rock.gone = true
    rock.back = this.time + ROCK_BACK
    this.changed.rocks.add(rock.id)
    let k = 0
    for (const [kind, n] of ROCKS[rock.kind].loot) {
      for (let i = 0; i < n; i++, k++) {
        const a = (k / 7) * Math.PI * 2
        this.drop(kind, 1, rock.x + Math.cos(a) * 18, rock.y + Math.sin(a) * 10)
      }
    }
    this.news.push({ t: 'fx', k: 'crush', id: rock.id, x: rock.x, y: rock.y })
  }

  // Tirer une flèche vers `ang` (radians) : il faut un arc en main et des flèches (la meilleure part).
  shoot (id, ang, power = 1) {
    const p = this.players.get(id)
    const bow = p && this.tool(p)
    if (!p?.alive || !bow?.arrow || !Number.isFinite(ang) || this.time < p.ready || this.swimming(p)) return
    const ammo = Object.keys(AMMO).find((k) => (p.inv[k] ?? 0) > 0)
    if (!ammo || !this.take(p, ammo, 1)) return
    p.ready = this.time + SHOOT_EVERY
    p.act = 'shoot'
    p.actAt = this.time
    const k = DRAWN_MIN + (1 - DRAWN_MIN) * (Number.isFinite(power) ? Math.min(1, Math.max(0, power)) : 1)
    this.arrows.push({ x: p.x, y: p.y - 14, vx: Math.cos(ang) * ARROW_SPEED, vy: Math.sin(ang) * ARROW_SPEED, left: bow.range * k, by: p.id, dmg: Math.round((bow.arrow + AMMO[ammo]) * k) })
  }

  // Une bête touchée (`how` : ce qui la touche, voir TOOLS) : ce qu'elle craint lui fait plus mal, et
  // étourdie (parée), elle prend double.
  hurt (beast, dmg, by, how = {}) {
    const weak = BEASTS[beast.kind]?.weak ?? {}
    for (const k of ['blunt', 'pierce']) if (how[k] && weak[k]) dmg *= weak[k]
    if (this.time < beast.stun) dmg *= STUN_DMG
    dmg = Math.round(dmg * 10) / 10
    beast.hp -= dmg
    beast.hurt = this.time
    this.news.push({ t: 'fx', k: 'hit', id: beast.id, dmg, x: Math.round(beast.x), y: Math.round(beast.y), player: by?.id ?? 0, kind: how.blow ?? null })
    if (beast.hp <= 0) {
      this.kill(beast)
      return false
    }
    if (beast.kind === 'deer') this.scare(beast, by)
    else if (beast.kind !== 'eikthyr') this.enrage(beast, by)
    else if (by) beast.target = by.id
  }

  // La bête fonce sur `by` (le sanglier blessé, les grisets et les nains gris qui voient quelqu'un).
  enrage (beast, by, called = false) {
    if (beast.state !== 'rage') beast.from = { x: beast.x, y: beast.y }
    beast.state = 'rage'
    beast.target = by?.id ?? null
    beast.until = this.time + RAGE_TIME
    // Les nains gris appellent ceux d'à côté (qui ne rappellent pas).
    const pack = BEASTS[beast.kind]?.pack
    if (!pack || called || !by) return
    for (const o of this.beasts.values()) {
      if (o !== beast && o.kind === beast.kind && o.state !== 'rage' && dist(o, beast) < pack) this.enrage(o, by, true)
    }
  }

  // La bête meurt : son butin par terre, autour d'elle.
  kill (beast) {
    this.beasts.delete(beast.id)
    // Un garde de mausolée tué : les gardes ne reviennent pas avant un moment ; une bête rare (le
    // troll), les siennes non plus.
    const post = beast.guards && this.crypts.find((c) => c.id === beast.guards)
    if (post) post.guardsAt = this.time + CRYPT.guardsBack
    const back = BEASTS[beast.kind]?.back
    if (back) (this.backAt ??= {})[beast.kind] = this.time + back
    this.news.push({ t: 'fx', k: 'die', id: beast.id, kind: beast.kind, x: Math.round(beast.x), y: Math.round(beast.y), d: beast.d })
    const loot = beast.kind === 'eikthyr' ? BOSS.loot.map(([k, n]) => [k, n, n]) : BEASTS[beast.kind].loot
    loot.forEach(([kind, lo, hi], k) => {
      const n = (lo + Math.floor(this.random() * (hi - lo + 1))) * STARS.loot[beast.stars ?? 0]
      if (!n) return
      const a = -Math.PI / 2 + (k - (loot.length - 1) / 2) * 0.9
      const r = beast.kind === 'eikthyr' ? 26 : 14
      this.drop(kind, n, beast.x + Math.cos(a) * r, beast.y + Math.sin(a) * r * 0.6 + 4)
    })
    if (beast.kind === 'eikthyr') {
      this.bolts = this.bolts.filter((v) => v.rock)
      this.news.push({ t: 'boss', on: false, killed: true })
    }
  }

  scare (beast, from) {
    beast.state = 'flee'
    beast.flee = from ? { x: from.x, y: from.y } : null
    beast.until = this.time + FLEE_TIME
  }

  // Ramasser ce qui est par terre, à portée.
  pick (id, itemId) {
    const p = this.players.get(id)
    const item = this.items.get(itemId)
    if (!p?.alive || !item || Math.hypot(item.x - p.x, item.y - p.y) > PICK_REACH) return false
    const kind = PICKS_AS[item.kind] ?? item.kind
    // Le sac plein : ce qui tient (le reste reste par terre).
    const n = this.fit(p, kind, item.n)
    if (!n) {
      this.news.push({ t: 'fx', k: 'full', player: p.id, x: Math.round(p.x), y: Math.round(p.y) })
      return false
    }
    if (n < item.n) {
      item.n -= n
      this.changed.items.add(item.id)
    } else this.remove(this.items, item.id)
    this.give(p, kind, n)
    this.news.push({ t: 'got', player: p.id, kind, n })
    return true
  }

  // Cueillir les baies d'un buisson mûr (framboises ou myrtilles).
  gather (id, bushId) {
    const p = this.players.get(id)
    const b = this.bushes.get(bushId)
    if (!p?.alive || !b?.ripe || Math.hypot(b.x - p.x, b.y - p.y) > PICK_REACH) return false
    const n = Math.round(between(BUSHES[b.kind].n, this.random))
    const kind = b.kind === 'blueberry' ? 'blueberries' : 'raspberry'
    b.ripe = false
    b.back = this.time + BUSH_BACK
    this.changed.bushes.add(b.id)
    this.give(p, kind, n)
    this.news.push({ t: 'got', player: p.id, kind, n })
    return true
  }

  // Le niveau du meilleur poste de travail de cette sorte (un feu allumé, un établi, une forge) à portée
  // (0 : aucun ; sans poste demandé : 1). Un établi gagne un niveau par extension posée près de lui.
  station (p, at) {
    if (!at) return 1
    if (at === 'fire') return [...this.fires.values()].some((f) => f.fuel > 0 && Math.hypot(f.x - p.x, f.y - p.y) <= FIRE_REACH) ? 1 : 0
    let best = 0
    for (const s of this.pieces.values()) {
      if (s.kind !== at || !this.touching(p, s)) continue
      if (at === 'cauldron' && !this.heated(s)) continue
      const near = new Set([...this.pieces.values()].filter((e) => EXTENSIONS.includes(e.kind) && Math.hypot(e.x - s.x, e.y - s.y) <= EXTENSION_RANGE).map((e) => e.kind))
      best = Math.max(best, 1 + (at === 'workbench' ? near.size : 0))
    }
    return best
  }

  // Un chaudron sur un feu allumé.
  // Le chaudron posé sur ce feu, s'il y en a un.
  potOn (f) {
    return [...this.pieces.values()].find((s) => s.kind === 'cauldron' && Math.hypot(f.x - s.x, f.y - s.y) <= CAULDRON_FIRE) ?? null
  }

  // Le poste de cuisson posé sur ce feu, s'il y en a un.
  spitOn (f) {
    return [...this.pieces.values()].find((s) => s.kind === 'cookingstation' && Math.hypot(f.x - s.x, f.y - s.y) <= CAULDRON_FIRE) ?? null
  }

  // Le feu le plus proche de (x, y), à moins de tant (le chaudron se pose en visant le feu).
  fireAt (x, y, r = 24) {
    return this.grid.fires.near(x, y, r).filter((f) => Math.hypot(f.x - x, f.y - y) < r).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0] ?? null
  }

  heated (s) {
    return [...this.fires.values()].some((f) => f.fuel > 0 && Math.hypot(f.x - s.x, f.y - s.y) <= CAULDRON_FIRE)
  }

  // Fabriquer : null si c'est fait, sinon pourquoi pas ('need' : il manque de quoi ; sinon le poste
  // de travail qu'il faut près de soi : 'workbench', 'forge', 'cauldron' ; 'level' : il est trop simple).
  craft (id, what) {
    const p = this.players.get(id)
    const r = RECIPE[what]
    if (!p?.alive || !r) return 'none'
    if (!this.has(p, r.need)) return 'need'
    const level = this.station(p, r.at)
    if (!level) return r.at
    if (level < (r.level ?? 1)) return 'level'
    // (Payé d'abord : ce qu'on dépense libère peut-être la place.)
    this.pay(p, r.need)
    if (this.fit(p, r.gives[0], r.gives[1]) < r.gives[1]) {
      for (const [k, n] of Object.entries(r.need)) this.give(p, k, n)
      return 'full'
    }
    this.give(p, ...r.gives)
    this.news.push({ t: 'got', player: p.id, kind: r.gives[0], n: r.gives[1] })
    return null
  }

  // Améliorer un outil, une arme, un vêtement qu'on a : null si c'est fait, sinon pourquoi pas ('need',
  // le poste qu'il faut, 'level' : le poste n'est pas assez haut, 'max' : déjà au mieux).
  upgrade (id, kind) {
    const p = this.players.get(id)
    const r = UPGRADES[kind]
    if (!p?.alive || !r || !p.inv[kind]) return 'none'
    const q = this.quality(p, kind)
    if (q >= QUALITY_MAX) return 'max'
    const cost = upgradeCost(r)
    if (!this.has(p, cost)) return 'need'
    const level = this.station(p, r.at)
    if (!level) return r.at ?? 'workbench'
    if (level < q + 1) return 'level'
    this.pay(p, cost)
    p.quality[kind] = q + 1
    this.news.push({ t: 'got', player: p.id, kind, n: 0, quality: q + 1 })
    return null
  }

  // Poser un feu de camp en (x, y) : assez près, sur la terre ferme, pas collé à autre chose.
  build (id, x, y) {
    const p = this.players.get(id)
    const need = BUILDS[0].need
    if (!p?.alive || !Number.isFinite(x) || !Number.isFinite(y) || !this.has(p, need) || p.held !== 'hammer') return false
    // Sur la grille, comme le reste : au milieu de sa case.
    ;[x, y] = World.spot(x, y)
    if (Math.hypot(x - p.x, y - p.y) > BUILD_REACH || !this.dry(x, y) || CRYPT_TILES.has(this.tile(x, y)) || this.solidAt(x, y)) return false
    const crowded = this.grid.trees.near(x, y, BUILD_ROOM).some((t) => !t.stump && Math.hypot(t.x - x, t.y - y) < BUILD_ROOM) ||
      this.grid.rocks.near(x, y, BUILD_ROOM + 6).some((k) => !k.gone && Math.hypot(k.x - x, k.y - y) < BUILD_ROOM + 6) ||
      Math.hypot(this.altar.x - x, this.altar.y - y) < 40 ||
      this.crypts.some((c) => Math.abs(c.x - x) < CRYPT.w + 10 && y > c.y - CRYPT.h - 10 && y < c.y + 20) ||
      [...this.fires.values()].some((f) => Math.hypot(f.x - x, f.y - y) < BUILD_ROOM * 2) ||
      [...this.players.values()].some((o) => o.alive && Math.hypot(o.x - x, o.y - y) < 10)
    if (crowded) return false
    this.pay(p, need)
    const fid = this.nextId++
    this.fires.set(fid, { id: fid, x: Math.round(x), y: Math.round(y), fuel: FIRE_START, cooking: [], by: p.account })
    this.grid.fires.add(this.fires.get(fid))
    this.changed.fires.add(fid)
    return true
  }

  // Où va un feu de camp visé en (x, y) : au milieu de sa case (son pied un peu plus bas).
  static spot (x, y) {
    return [(Math.floor(x / TILE) + 0.5) * TILE, (Math.floor(y / TILE) + 0.75) * TILE]
  }

  // La case en haut à gauche d'une pièce de w × h cases posée en (x, y) (la souris : le milieu de la
  // rangée du bas de la pièce, comme on la voit).
  static corner (x, y, w, h = 1) {
    return { tx: Math.round(x / TILE - w / 2), ty: Math.floor(y / TILE) - h + 1 }
  }

  // Pourquoi une pièce (ou une carotte) ne va pas là : null si elle peut ; 'far', 'bench', 'blocked'.
  fits (p, kind, tx, ty, rot = 0) {
    const def = PIECES[kind] ?? { w: 1, h: 1, flat: false }
    const piece = { ...def, ...sized(def, rot) }
    const x = (tx + piece.w / 2) * TILE
    const y = (ty + piece.h) * TILE
    if (Math.hypot(x - p.x, y - TILE / 2 - p.y) > PIECE_REACH) return 'far'
    if (piece.bench && !this.nearBench(x, y)) return 'bench'
    const [x0, y0, x1, y1] = [tx * TILE, ty * TILE, (tx + piece.w) * TILE, (ty + piece.h) * TILE]
    for (let j = ty; j < ty + piece.h; j++) {
      for (let i = tx; i < tx + piece.w; i++) {
        if (i < 0 || j < 0 || i >= SIDE || j >= SIDE) return 'blocked'
        const k = j * SIDE + i
        // Ni sur une falaise, ni sur une rampe (on ne bouche pas un passage).
        if (this.cliff[k] || this.relief[k] & RELIEF.ramp) return 'blocked'
        if (piece.water ? !WET.has(this.tiles[k]) : WET.has(this.tiles[k]) || CRYPT_TILES.has(this.tiles[k])) return 'blocked'
        if (kind === 'till') {
          if (!SOIL.has(this.tiles[k]) || this.tilled.has(k) || this.cropAt.has(k) || this.solid.has(k) || this.flat.has(k)) return 'blocked'
        } else if (PLANTS[kind]?.tilled) {
          if (!this.tilled.has(k)) return 'untilled'
          if (this.cropAt.has(k) || this.solid.has(k) || this.flat.has(k)) return 'blocked'
        } else if (PLANTS[kind]) {
          if (!SOIL.has(this.tiles[k]) || this.cropAt.has(k) || this.solid.has(k) || this.flat.has(k)) return 'blocked'
          if (PLANTS[kind].tree && this.forest[k] !== (PLANTS[kind].wild ? 1 : 0)) return 'biome'
        } else if (piece.cover ? this.covers.has(k) || this.solid.has(k) || this.cropAt.has(k) : piece.flat ? this.flat.has(k) || this.cropAt.has(k) : this.solid.has(k) || this.cropAt.has(k)) return 'blocked'
      }
    }
    if (piece.flat || piece.cover) return null
    const inside = (o, m) => o.x > x0 - m && o.x < x1 + m && o.y > y0 - m && o.y < y1 + m
    if (this.grid.trees.near(x, y, 40).some((t) => !t.stump && inside(t, 5))) return 'blocked'
    // Une graine d'arbre : de la place autour (ni arbre, ni souche, ni autre pousse).
    if (PLANTS[kind]?.tree && (this.grid.trees.near(x, y, SAPLING_ROOM + 10).some((t) => Math.hypot(t.x - x, t.y - TILE / 2 - y + TILE / 2) < SAPLING_ROOM) || [...this.crops.values()].some((c) => PLANTS[c.kind].tree && Math.hypot(c.x - x, c.y - y) < SAPLING_ROOM))) return 'blocked'
    if (PLANTS[kind] || kind === 'till') return null
    if (this.grid.rocks.near(x, y, 50).some((k) => !k.gone && inside(k, 12))) return 'blocked'
    if (this.grid.fires.near(x, y, 40).some((f) => inside(f, 8) && !ON_FIRE.has(kind)) || inside(this.altar, 40)) return 'blocked'
    if (this.crypts.some((c) => inside({ x: c.x, y: c.y - CRYPT.h / 2 }, CRYPT.w + 4))) return 'blocked'
    if ([...this.players.values()].some((o) => o.alive && inside(o, 3)) || [...this.beasts.values()].some((b) => inside(b, 3))) return 'blocked'
    return null
  }

  // Poser une construction (ou planter une carotte) là où le joueur vise : null si c'est fait, sinon
  // pourquoi pas ('need', 'far', 'bench', 'blocked' ; 'tool' : planter sans cultivateur).
  place (id, kind, x, y, rot = 0) {
    const p = this.players.get(id)
    if (!p?.alive || !Number.isFinite(x) || !Number.isFinite(y) || !(PIECES[kind] || PLANTS[kind] || kind === 'till' || BOATS[kind])) return 'none'
    const need = PIECES[kind]?.need ?? PLANTS[kind]?.need ?? {}
    // Il faut l'outil en main : le cultivateur pour la terre, le marteau pour le reste.
    const farming = !!PLANTS[kind] || kind === 'till'
    if (farming && p.held !== 'cultivator') return 'tool'
    if (!farming && p.held !== 'hammer') return 'hammer'
    if (BOATS[kind]) return this.launch(p, x, y, kind)
    if (!this.has(p, need)) return 'need'
    if (!PIECES[kind]?.rots.includes(rot)) rot = 0
    const { w, h } = PIECES[kind] ? sized(PIECES[kind], rot) : { w: 1, h: 1 }
    // Le chaudron, le poste de cuisson, en visant un feu : posés dessus (sur sa case), un seul par feu ;
    // le poste de cuisson ne va que là.
    const fire = ON_FIRE.has(kind) && this.fireAt(x, y)
    if (kind === 'cookingstation' && !fire) return 'fire'
    if (fire && (this.potOn(fire) || this.spitOn(fire))) return 'blocked'
    const { tx, ty } = fire ? { tx: Math.floor(fire.x / TILE), ty: Math.floor(fire.y / TILE) } : World.corner(x, y, w, h)
    const why = this.fits(p, kind, tx, ty, rot)
    if (why) return why
    this.pay(p, need)
    if (kind === 'till') this.till(tx, ty)
    else if (PLANTS[kind]) this.addCrop(tx, ty, this.time, kind)
    else this.addPiece(kind, tx, ty, { by: p.account, rot })
    return null
  }

  // La terre retournée : on pourra y planter.
  till (tx, ty) {
    this.tilled.add(ty * SIDE + tx)
    this.changed.tilled.add(ty * SIDE + tx)
  }

  // Où une sorte de pièce prend ses cases : debout, à plat (le plancher), posée dessus (le tapis).
  layer (def) {
    return def.cover ? this.covers : def.flat ? this.flat : this.solid
  }

  // Le joueur est collé à cette pièce (à moins de TOUCH de son bord).
  touching (p, piece) {
    const [x0, y0, x1, y1] = [piece.tx * TILE, piece.ty * TILE, (piece.tx + piece.w) * TILE, (piece.ty + piece.h) * TILE]
    return Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(y0 - p.y, 0, p.y - y1)) <= TOUCH
  }

  addPiece (kind, tx, ty, extra = {}) {
    const def = PIECES[kind]
    const id = this.nextId++
    const rot = def.rots.includes(extra.rot) ? extra.rot : 0
    const { w, h } = sized(def, rot)
    const piece = { id, kind, tx, ty, w, h, x: (tx + w / 2) * TILE, y: (ty + h) * TILE, open: false, queue: [], by: null, name: '', store: {}, quality: {}, ...extra, rot }
    this.pieces.set(id, piece)
    for (let j = ty; j < ty + h; j++) for (let i = tx; i < tx + w; i++) this.layer(def).set(j * SIDE + i, piece)
    this.changed.pieces.add(id)
    return piece
  }

  addCrop (tx, ty, planted, kind = 'carrot') {
    const id = this.nextId++
    const crop = { id, kind, tx, ty, x: (tx + 0.5) * TILE, y: (ty + 1) * TILE - 2, planted, stage: 0 }
    crop.stage = this.stageOf(crop)
    this.crops.set(id, crop)
    this.cropAt.set(ty * SIDE + tx, crop)
    this.changed.crops.add(id)
    return crop
  }

  stageOf (crop) {
    const age = this.time - crop.planted
    const grow = PLANTS[crop.kind].grow
    return age >= grow ? 2 : age >= grow / 2 ? 1 : 0
  }

  // Un arbre né d'une graine (il se garde d'un redémarrage à l'autre : voir `snapshot`).
  growTree (kind, x, y, stump = false) {
    const id = this.nextId++
    const tree = { id, kind, x: Math.round(x), y: Math.round(y), hp: stump ? STUMP_HP : TREES[kind].hp, stump, regrow: 0, grown: true }
    this.trees.set(id, tree)
    this.grid.trees.add(tree)
    this.changed.grown.add(id)
    return tree
  }

  // Démonter une construction ou un feu (on récupère tout ce qu'elle a coûté, et le minerai pas encore fondu) ou
  // arracher une carotte pas encore mûre (on la récupère).
  unbuild (id, what) {
    const p = this.players.get(id)
    // Le marteau en main (une carotte s'arrache à la main).
    if (p?.held !== 'hammer' && !this.crops.has(what)) return false
    // Un feu de camp : ses pierres, son bois, la viande qui cuisait.
    const fire = this.fires.get(what)
    if (fire) {
      if (!p?.alive || Math.hypot(fire.x - p.x, fire.y - p.y) > PIECE_REACH) return false
      this.grid.fires.delete(fire)
      this.remove(this.fires, fire.id)
      for (const [k, n] of Object.entries(BUILDS[0].need)) this.give(p, k, n)
      if (fire.cooking.length) this.give(p, 'meat', fire.cooking.length)
      this.news.push({ t: 'fx', k: 'unbuild', x: fire.x, y: fire.y })
      return true
    }
    // Un bateau (personne à bord) : on récupère tout.
    const boat = this.boats.get(what)
    if (boat) {
      if (!p?.alive || boat.rider || Math.hypot(boat.x - p.x, boat.y - p.y) > PIECE_REACH) return false
      this.remove(this.boats, boat.id)
      for (const [k, n] of Object.entries(BOATS[boat.kind].need)) this.give(p, k, n)
      this.news.push({ t: 'fx', k: 'unbuild', x: boat.x, y: boat.y })
      return true
    }
    const piece = this.pieces.get(what)
    const crop = this.crops.get(what)
    const it = piece ?? crop
    if (!p?.alive || !it || Math.hypot(it.x - p.x, it.y - p.y) > PIECE_REACH) return false
    if (crop) {
      // Arrachée, elle rend ce qu'elle a coûté (une carotte mûre : sa récolte).
      this.cropAt.delete(crop.ty * SIDE + crop.tx)
      this.remove(this.crops, crop.id)
      const plant = PLANTS[crop.kind]
      if (plant.once && crop.stage === 2) this.give(p, ...plant.gives)
      else for (const [k, n] of Object.entries(plant.need)) this.give(p, k, n)
      return true
    }
    // Ce qu'il y avait dans un coffre revient à qui le démonte ; la viande qui cuisait sur le poste de
    // cuisson aussi (crue).
    for (const k of Object.keys(piece.store)) this.withdraw(p, piece, k, undefined, true)
    if (piece.kind === 'cookingstation') {
      for (const f of this.fires.values()) {
        if (this.spitOn(f) !== piece || !f.cooking.length) continue
        this.give(p, 'meat', f.cooking.length)
        f.cooking = []
        this.changed.fires.add(f.id)
      }
    }
    const def = PIECES[piece.kind]
    for (let j = piece.ty; j < piece.ty + piece.h; j++) for (let i = piece.tx; i < piece.tx + piece.w; i++) this.layer(def).delete(j * SIDE + i)
    this.remove(this.pieces, piece.id)
    for (const [k, n] of Object.entries(def.need)) this.give(p, k, n)
    for (const job of piece.queue) this.give(p, job.ore, 1)
    for (const o of this.players.values()) if (o.bed && o.bed.x === piece.x && o.bed.y === piece.y) o.bed = null
    this.news.push({ t: 'fx', k: 'unbuild', x: Math.round(piece.x), y: Math.round(piece.y) })
    return true
  }

  // Se servir d'une construction : ouvrir ou fermer une porte, dormir (le lit devient le point de
  // retour), mettre du minerai dans la fonderie (avec une bûche). null si c'est fait, sinon pourquoi pas.
  use (id, what) {
    const p = this.players.get(id)
    const piece = this.pieces.get(what)
    if (!p?.alive || !piece || !this.touching(p, piece)) return 'far'
    if (piece.kind === 'door') {
      // Une double porte (deux portes accolées dans le même sens) s'ouvre et se ferme d'un coup ; pas de
      // porte qu'on referme sur quelqu'un.
      const doors = [piece, this.twin(piece)].filter(Boolean)
      const inside = (d) => (o) => o.x > d.tx * TILE - 3 && o.x < (d.tx + 1) * TILE + 3 && o.y > d.ty * TILE && o.y < (d.ty + 1) * TILE + 2
      const crowded = (d) => [...this.players.values()].some((o) => o.alive && inside(d)(o)) || [...this.beasts.values()].some(inside(d))
      if (piece.open && doors.some(crowded)) return 'blocked'
      const open = !piece.open
      for (const d of doors) {
        d.open = open
        this.changed.pieces.add(d.id)
      }
      return null
    }
    // Le lit : on y reviendra ; la nuit, on s'y endort (quand tous dorment, le jour se lève).
    if (piece.kind === 'bed') {
      p.bed = { x: piece.x, y: piece.y }
      if (this.night()) {
        p.asleep = true
        this.news.push({ t: 'fx', k: 'sleep', player: p.id, x: piece.x, y: piece.y })
      } else this.news.push({ t: 'got', player: p.id, kind: 'bed', n: 0 })
      return null
    }
    if (piece.kind === 'portal') return this.travel(p, piece)
    if (piece.kind === 'smelter') {
      const ore = Object.keys(SMELTS).find((k) => p.inv[k])
      if (!ore) return 'ore'
      if (!p.inv.wood) return 'wood'
      if (piece.queue.length >= SMELT_MAX) return 'full'
      this.take(p, ore, 1)
      this.take(p, 'wood', 1)
      const last = piece.queue.at(-1)?.at ?? this.time
      piece.queue.push({ ore, at: Math.max(last, this.time) + SMELT_TIME })
      this.changed.pieces.add(piece.id)
      return null
    }
    return 'none'
  }

  // L'autre battant d'une double porte : la porte accolée dans le même sens (de face : à gauche ou à
  // droite ; de profil : au-dessus ou au-dessous), s'il y en a une.
  twin (door) {
    const [dx, dy] = door.rot === 1 ? [0, 1] : [1, 0]
    for (const s of [1, -1]) {
      const o = this.solid.get((door.ty + dy * s) * SIDE + door.tx + dx * s)
      if (o?.kind === 'door' && o.rot === door.rot) return o
    }
    return null
  }

  // Ranger n choses d'une sorte dans un coffre (tout ce qu'on en a si n manque) : null si c'est fait,
  // sinon pourquoi pas ('far', 'none', 'full' : déjà CHEST_KINDS sortes dedans). La qualité suit.
  store (id, chestId, kind, n) {
    const p = this.players.get(id)
    const chest = this.pieces.get(chestId)
    if (!p?.alive || chest?.kind !== 'chest' || !this.touching(p, chest)) return 'far'
    const have = p.inv[kind] ?? 0
    const k = Number.isInteger(n) && n > 0 ? Math.min(n, have) : have
    if (!k) return 'none'
    if (!chest.store[kind] && Object.keys(chest.store).length >= CHEST_KINDS) return 'full'
    const q = this.quality(p, kind)
    this.take(p, kind, k)
    chest.store[kind] = (chest.store[kind] ?? 0) + k
    if (q > 1) chest.quality[kind] = Math.max(chest.quality[kind] ?? 1, q)
    this.changed.pieces.add(chest.id)
    return null
  }

  // Reprendre n choses d'une sorte dans un coffre (toutes si n manque) : null si c'est fait.
  unstore (id, chestId, kind, n) {
    const p = this.players.get(id)
    const chest = this.pieces.get(chestId)
    if (!p?.alive || chest?.kind !== 'chest' || !this.touching(p, chest)) return 'far'
    return this.withdraw(p, chest, kind, n)
  }

  // Reprendre d'un coffre (ce qui tient dans le sac) ; `spill` (le coffre démonté) : ce qui ne tient
  // pas tombe par terre.
  withdraw (p, chest, kind, n, spill = false) {
    const have = chest.store[kind] ?? 0
    const want = Number.isInteger(n) && n > 0 ? Math.min(n, have) : have
    const k = spill ? want : this.fit(p, kind, want)
    if (!want) return 'none'
    if (!k) return 'full'
    chest.store[kind] -= k
    const q = chest.quality[kind]
    if (q) p.quality[kind] = Math.max(p.quality[kind] ?? 1, q)
    if (!chest.store[kind]) {
      delete chest.store[kind]
      delete chest.quality[kind]
    }
    const keep = spill ? this.fit(p, kind, k) : k
    if (keep) this.give(p, kind, keep)
    if (k > keep) this.drop(kind, k - keep, chest.x, chest.y + 10)
    this.changed.pieces.add(chest.id)
    return null
  }

  // Mettre un bateau à l'eau en (x, y) : null si c'est fait, sinon pourquoi pas ('need', 'far',
  // 'bench', 'blocked' : pas sur l'eau, ou trop près d'un autre bateau).
  launch (p, x, y, kind = 'boat') {
    const need = BOATS[kind].need
    if (!this.has(p, need)) return 'need'
    if (Math.hypot(x - p.x, y - p.y) > PIECE_REACH) return 'far'
    if (!this.nearBench(x, y)) return 'bench'
    if (!this.sailable(x, y) || [...this.boats.values()].some((b) => Math.hypot(b.x - x, b.y - y) < BOAT_ROOM)) return 'blocked'
    this.pay(p, need)
    this.addBoat(Math.round(x), Math.round(y), 3, kind)
    return null
  }

  addBoat (x, y, d, kind = 'boat') {
    const id = this.nextId++
    this.boats.set(id, { id, kind: BOATS[kind] ? kind : 'boat', x, y, d, rider: null })
    this.changed.boats.add(id)
    return this.boats.get(id)
  }

  // Monter dans un bateau tout près (personne à bord) : null si c'est fait.
  board (id, boatId) {
    const p = this.players.get(id)
    const boat = this.boats.get(boatId)
    if (!p?.alive || p.boat || !boat || Math.hypot(boat.x - p.x, boat.y - p.y) > BOAT_REACH) return 'far'
    if (boat.rider) return 'taken'
    Object.assign(p, { boat: boat.id, x: boat.x, y: boat.y, moved: this.time })
    boat.rider = p.id
    this.changed.boats.add(boat.id)
    this.news.push({ t: 'moved', player: p.id })
    this.news.push({ t: 'inv', player: p.id })
    return null
  }

  // Débarquer sur la terre ferme la plus proche (assez près) : null si c'est fait, 'noland' sinon.
  land (id) {
    const p = this.players.get(id)
    if (!p?.alive || !p.boat) return 'none'
    let best = null
    for (let r = 14; r <= 56 && !best; r += 6) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        const at = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r * 0.8 }
        if (this.walkable(at.x, at.y) && (!best || dist(at, p) < dist(best, p))) best = at
      }
    }
    if (!best) return 'noland'
    this.ashore(p)
    Object.assign(p, { x: Math.round(best.x), y: Math.round(best.y), moved: this.time })
    this.news.push({ t: 'moved', player: p.id })
    this.news.push({ t: 'inv', player: p.id })
    return null
  }

  // Récolter ce qui est mûr : la carotte s'arrache ; le buisson, les champignons repoussent.
  harvest (id, cropId) {
    const p = this.players.get(id)
    const crop = this.crops.get(cropId)
    const plant = crop && PLANTS[crop.kind]
    if (!p?.alive || !crop || !plant.gives || crop.stage < 2 || Math.hypot(crop.x - p.x, crop.y - p.y) > PICK_REACH) return false
    const [kind, n] = plant.gives
    if (plant.once) {
      this.cropAt.delete(crop.ty * SIDE + crop.tx)
      this.remove(this.crops, crop.id)
    } else {
      crop.planted = this.time - plant.grow / 2
      crop.stage = this.stageOf(crop)
      this.changed.crops.add(crop.id)
    }
    this.give(p, kind, n)
    this.news.push({ t: 'got', player: p.id, kind, n })
    return true
  }

  nearFire (p, fireId) {
    const f = this.fires.get(fireId)
    // (Un chaudron dessus : on l'alimente d'aussi loin qu'on se sert du chaudron.)
    return f && Math.hypot(f.x - p.x, f.y - p.y) <= (this.potOn(f) || this.spitOn(f) ? USE_REACH : FIRE_REACH) ? f : null
  }

  // Une bûche de plus dans le feu (il se rallume s'il était éteint).
  fuel (id, fireId) {
    const p = this.players.get(id)
    const f = p?.alive && this.nearFire(p, fireId)
    if (!f || f.fuel >= FIRE_MAX - 1 || !this.take(p, 'wood', 1)) return false
    f.fuel = Math.min(FIRE_MAX, f.fuel + FIRE_LOG)
    this.changed.fires.add(f.id)
    return true
  }

  // De la viande crue à cuire, sur le poste de cuisson d'un feu allumé : cuite, elle tombe à côté
  // (n'importe qui peut la prendre).
  cook (id, fireId) {
    const p = this.players.get(id)
    const f = p?.alive && this.nearFire(p, fireId)
    if (!f || f.fuel <= 0 || f.cooking.length >= COOK_MAX || !this.spitOn(f) || !this.take(p, 'meat', 1)) return false
    f.cooking.push(this.time + COOK_TIME)
    this.changed.fires.add(f.id)
    return true
  }

  // Manger : un repas de plus (trois au plus, pas deux fois le même tant qu'il dure). Il donne de la
  // vie tout de suite, et en plus au maximum tant qu'il dure. Renvoie pourquoi c'est refusé, sinon null.
  eat (id, kind) {
    const p = this.players.get(id)
    const food = FOODS[kind]
    if (!p?.alive || !food || !p.inv[kind]) return 'none'
    const same = p.food.find((f) => f.kind === kind)
    if (same && same.until - this.time > food.time * MEAL_AGAIN) return 'same'
    if (!same && p.food.length >= MEALS) return 'full'
    this.take(p, kind, 1)
    if (same) same.until = this.time + food.time
    else p.food.push({ kind, until: this.time + food.time })
    p.hp = Math.min(this.maxHp(p), p.hp + food.hp)
    p.act = 'eat'
    p.actAt = this.time
    return null
  }

  // Déposer les bois de cerf sur l'autel : Eikthyr arrive (un seul à la fois).
  offer (id) {
    const p = this.players.get(id)
    if (!p?.alive || Math.hypot(this.altar.x - p.x, this.altar.y - p.y) > ALTAR_REACH) return 'far'
    if (this.boss() || this.summoning) return 'busy'
    if (!this.has(p, SUMMON)) return 'need'
    this.pay(p, SUMMON)
    this.summoning = { at: this.time + SUMMON_DELAY, by: p.name }
    this.news.push({ t: 'boss', on: true, by: p.name })
    this.news.push({ t: 'fx', k: 'summon', x: this.altar.x, y: this.altar.y })
    return null
  }

  // Revenir : à son lit s'il est encore là (juste devant), sinon au départ.
  respawn (id) {
    const p = this.players.get(id)
    if (!p || p.alive) return
    const bed = p.bed && [...this.pieces.values()].find((x) => x.kind === 'bed' && x.x === p.bed.x && x.y === p.bed.y)
    const at = bed && this.walkable(bed.x, bed.y + 8) ? { x: bed.x, y: bed.y + 8 } : this.spawn
    if (!bed) p.bed = null
    Object.assign(p, { alive: true, hp: BASE_HP, food: [], x: at.x, y: at.y, moved: this.time, hurt: -99 })
    this.news.push({ t: 'respawn', player: p.id })
  }

  // Un coup reçu (de `from`, la bête qui frappe, s'il y en a une) : le bouclier levé face à elle en
  // arrête une part (toute, et l'étourdit, s'il vient d'être levé : la parade), l'armure une autre.
  damage (p, dmg, by, from = null) {
    if (!p.alive) return
    // En pleine roulade : rien ne porte.
    if (this.time - (p.rolled ?? -99) < COMBAT.iframes) {
      this.news.push({ t: 'fx', k: 'dodge', id: p.id, player: p.id, x: Math.round(p.x), y: Math.round(p.y) })
      return
    }
    const shield = p.guard !== null && this.shield(p)
    if (shield && this.facing(p, from)) {
      const parry = shield.parry > 0 && this.time - p.guard <= PARRY
      const power = shield.block * (parry ? shield.parry : 1)
      const cost = parry ? PARRY_STAMINA : Math.round(BLOCK_STAMINA * Math.min(1.5, Math.max(0.3, dmg / power)))
      this.news.push({ t: 'fx', k: parry ? 'parry' : 'block', id: p.id, player: p.id, dmg: cost, x: Math.round(p.x), y: Math.round(p.y) })
      if (parry && from && this.beasts.has(from.id)) this.stun(from)
      dmg = Math.max(0, dmg - power)
      if (dmg <= 0) return
    }
    const hurt = Math.max(1, Math.round(absorb(dmg, this.armor(p))))
    p.hp -= hurt
    p.hurt = this.time
    p.asleep = false
    this.news.push({ t: 'fx', k: 'hurt', id: p.id, dmg: hurt, x: Math.round(p.x), y: Math.round(p.y) })
    if (p.hp <= 0) this.die(p, by)
  }

  // Le joueur est tourné vers `from` (à peu près : un demi-tour devant lui) ; sans `from` (un éclair), oui.
  facing (p, from) {
    if (!from) return true
    const [fx, fy] = [[0, 1], [0, -1], [-1, 0], [1, 0]][p.d]
    const [dx, dy] = [from.x - p.x, from.y - p.y]
    const len = Math.hypot(dx, dy)
    return len < 1 || (dx * fx + dy * fy) / len > -0.15
  }

  // Une bête parée : étourdie un instant (elle ne bouge plus, ne frappe plus, et prend double).
  stun (b) {
    b.stun = this.time + STUN_TIME
    b.swing = null
    b.rush = null
    b.vx = 0
    b.vy = 0
    this.news.push({ t: 'fx', k: 'stun', id: b.id, x: Math.round(b.x), y: Math.round(b.y) })
  }

  // Mort : tout ce qu'il avait reste dans une tombe, là où il est tombé.
  die (p, by) {
    p.hp = 0
    p.alive = false
    p.food = []
    p.guard = null
    this.ashore(p)
    if (Object.keys(p.inv).length) {
      const id = this.nextId++
      this.tombs.set(id, { id, x: Math.round(p.x), y: Math.round(p.y), name: p.name, inv: p.inv, quality: p.quality, worn: p.worn, held: p.held })
      this.changed.tombs.add(id)
      p.inv = {}
      p.quality = {}
      p.worn = {}
      p.held = null
      this.news.push({ t: 'inv', player: p.id })
    }
    this.news.push({ t: 'dead', player: p.id, by })
  }

  // Reprendre ce qu'il y a dans une tombe (la sienne ou celle d'un autre) : tout revient, ce qu'on portait
  // aussi (si la place est libre). null si c'est fait, sinon pourquoi pas.
  loot (id, tombId) {
    const p = this.players.get(id)
    const tomb = this.tombs.get(tombId)
    if (!p?.alive || !tomb) return 'none'
    if (Math.hypot(tomb.x - p.x, tomb.y - p.y) > USE_REACH) return 'far'
    // Ce qui tient dans le sac (les sortes qu'on a déjà, et les autres tant qu'il reste des cases) ; le
    // reste attend dans la tombe.
    for (const [kind, all] of Object.entries(tomb.inv)) {
      // (Ce qu'il portait reprend sa place : pas dans le sac.)
      const wearing = Object.values(tomb.worn).includes(kind) && !p.worn[WEAR[kind]?.slot]
      const n = Math.min(all, (wearing ? 1 : 0) + this.fit(p, kind, all))
      if (!n) continue
      p.inv[kind] = (p.inv[kind] ?? 0) + n
      const q = tomb.quality[kind] ?? 1
      if (q > this.quality(p, kind)) p.quality[kind] = q
      if (n < all) {
        tomb.inv[kind] -= n
        continue
      }
      delete tomb.inv[kind]
      if (!p.worn[WEAR[kind]?.slot] && Object.values(tomb.worn).includes(kind)) p.worn[WEAR[kind].slot] = kind
      if (!p.held && tomb.held === kind) p.held = kind
    }
    this.news.push({ t: 'inv', player: p.id })
    if (Object.keys(tomb.inv).length) {
      this.changed.tombs.add(tomb.id)
      return 'full'
    }
    this.remove(this.tombs, tomb.id)
    this.news.push({ t: 'fx', k: 'loot', player: p.id, x: tomb.x, y: tomb.y })
    return null
  }

  step (dt) {
    this.time += dt
    const t = this.time
    // Tous endormis la nuit : le jour se lève.
    const [asleep, alive] = this.sleepers()
    if (asleep && asleep === alive && this.night()) {
      this.dawn = t
      for (const p of this.players.values()) p.asleep = false
      this.news.push({ t: 'fx', k: 'wake', x: 0, y: 0 })
    }
    if (!this.night()) for (const p of this.players.values()) p.asleep = false
    // La pluie vient et s'en va.
    if (t >= this.weather.until) {
      const rain = !this.weather.rain
      const [a, b] = rain ? RAIN : DRY
      this.weather = { rain, until: t + a + this.random() * (b - a) }
    }
    for (const p of this.players.values()) {
      if (!p.alive) continue
      const before = p.food.length
      p.food = p.food.filter((f) => f.until > t)
      if (p.food.length !== before) this.news.push({ t: 'inv', player: p.id })
      const max = this.maxHp(p)
      if (p.hp > max) p.hp = max
      if (p.hp < max && t - p.hurt > REGEN_AFTER) p.hp = Math.min(max, p.hp + (REGEN + REGEN_FOOD * p.food.length) * dt)
    }
    if (this.summoning && t >= this.summoning.at) {
      const near = [...this.players.values()].filter((p) => p.alive && dist(p, this.altar) < BOSS.sight).length
      const hp = BOSS.hp + BOSS.hpPerPlayer * Math.max(0, near - 1)
      const b = this.spawnBeast('eikthyr', this.altar.x, this.altar.y - 70, hp)
      Object.assign(b, { state: 'walk', chargeAt: t + between(BOSS.chargeEvery, this.random), boltAt: t + 3, meleeAt: t, alone: t })
      this.summoning = null
      this.news.push({ t: 'fx', k: 'arrive', id: b.id, x: Math.round(b.x), y: Math.round(b.y) })
    }
    const players = [...this.players.values()].filter((p) => p.alive)
    for (const b of [...this.beasts.values()]) {
      if (b.kind === 'eikthyr') this.eikthyr(b, dt)
      else if (players.some((p) => Math.abs(p.x - b.x) < AWAKE && Math.abs(p.y - b.y) < AWAKE)) this.think(b, dt)
      else {
        b.vx = 0
        b.vy = 0
      }
    }
    this.strike()
    this.fly(dt)
    this.dungeons(t)
    for (const f of this.fires.values()) {
      if (f.fuel > 0) {
        f.fuel = Math.max(0, f.fuel - dt)
        if (f.fuel === 0) this.changed.fires.add(f.id)
      }
      const done = f.cooking.filter((at) => at <= t)
      if (done.length) {
        f.cooking = f.cooking.filter((at) => at > t)
        for (let k = 0; k < done.length; k++) this.drop('cooked', 1, f.x + 16 + k * 6, f.y + 6)
        this.changed.fires.add(f.id)
      }
    }
    // La fonderie : les lingots tombent devant elle.
    for (const s of this.pieces.values()) {
      if (s.kind !== 'smelter' || !s.queue.length || s.queue[0].at > t) continue
      const job = s.queue.shift()
      this.drop(SMELTS[job.ore], 1, s.x + (this.random() - 0.5) * 16, s.y + 8)
      this.changed.pieces.add(s.id)
    }
    // Ce qui est planté pousse ; une pousse d'arbre devenue grande : un arbre.
    for (const c of [...this.crops.values()]) {
      const stage = this.stageOf(c)
      if (stage === c.stage) continue
      if (stage === 2 && PLANTS[c.kind].tree) {
        this.cropAt.delete(c.ty * SIDE + c.tx)
        this.remove(this.crops, c.id)
        this.growTree(PLANTS[c.kind].tree, c.x, c.y + 2)
        continue
      }
      c.stage = stage
      this.changed.crops.add(c.id)
    }
    // Ce qui revient (les rochers, pas le cuivre ; les arbres jamais) : pas sur la tête de quelqu'un.
    const free = (x, y) => ![...this.players.values()].some((p) => Math.hypot(p.x - x, p.y - y) < 18)
    for (const rock of this.rocks.values()) {
      if (rock.gone && !ROCKS[rock.kind].once && t >= rock.back && free(rock.x, rock.y) && !this.solidAt(rock.x, rock.y)) {
        Object.assign(rock, { gone: false, hp: ROCKS[rock.kind].hp })
        this.changed.rocks.add(rock.id)
      }
    }
    for (const bush of this.bushes.values()) {
      if (!bush.ripe && t >= bush.back) {
        bush.ripe = true
        this.changed.bushes.add(bush.id)
      }
    }
    for (const item of this.items.values()) {
      if (t >= item.until) this.remove(this.items, item.id)
    }
    if (t >= this.litterAt) {
      this.litterAt = t + LITTER_EVERY
      this.restock()
    }
    if (t >= this.beastsAt) {
      this.beastsAt = t + BEASTS_EVERY
      this.repopulate()
    }
  }

  // Les éclairs annoncés (et les rochers des trolls) tombent : qui est dessous est touché.
  strike () {
    const now = this.bolts.filter((b) => b.at <= this.time)
    if (!now.length) return
    this.bolts = this.bolts.filter((b) => b.at > this.time)
    for (const bolt of now) {
      const [radius, dmg] = bolt.rock ? [bolt.radius, bolt.dmg] : [BOSS.boltRadius, BOSS.boltDmg]
      this.news.push({ t: 'fx', k: bolt.rock ? 'boulder' : 'bolt', x: Math.round(bolt.x), y: Math.round(bolt.y) })
      for (const p of this.players.values()) {
        if (p.alive && Math.hypot(p.x - bolt.x, p.y - bolt.y) < radius) this.damage(p, dmg, bolt.rock ? 'troll' : 'eikthyr')
      }
    }
  }

  // Les flèches avancent ; la première bête sur le chemin est touchée (un joueur, pour celles des archers) ;
  // un tronc (passé l'arbre d'où l'on tire) ou un mur les arrête.
  fly (dt) {
    const keep = []
    for (const a of this.arrows) {
      const speed = Math.hypot(a.vx, a.vy)
      const steps = Math.ceil((speed * dt) / 6)
      let hit = false
      for (let s = 0; s < steps && !hit; s++) {
        a.x += (a.vx * dt) / steps
        a.y += (a.vy * dt) / steps
        a.left -= (speed * dt) / steps
        a.flown = (a.flown ?? 0) + (speed * dt) / steps
        // La flèche d'un archer touche les joueurs (le bouclier levé vers elle l'arrête), pas les bêtes.
        if (a.hostile) {
          const p = [...this.players.values()].find((o) => o.alive && Math.abs(o.x - a.x) < 7 && a.y > o.y - 24 && a.y < o.y - 2)
          if (p) {
            hit = true
            this.damage(p, a.dmg, a.kind, { x: a.x - a.vx, y: a.y - a.vy })
            continue
          }
        }
        const beast = !a.hostile && [...this.beasts.values()].find((b) => {
          const k = sizeOf(b)
          return Math.abs(b.x - a.x) < 13 * k && Math.abs(b.y - 10 * k - a.y) < 10 * k
        })
        if (beast) {
          hit = true
          // Le bouclier d'un squelette arrête ce qui vient de face.
          const from = { x: a.x - a.vx, y: a.y - a.vy }
          const guarded = beast.shield && this.time >= beast.stun && this.facingBeast(beast, from)
          if (guarded) this.news.push({ t: 'fx', k: 'guard', id: beast.id, player: a.by, x: Math.round(beast.x), y: Math.round(beast.y) })
          this.hurt(beast, a.dmg * (guarded ? SHIELDED.through : 1), this.players.get(a.by), { pierce: true, blow: guarded ? 'guarded' : null })
        } else if (a.flown > 16 && this.grid.trees.near(a.x, a.y + 12, 16).some((t) => !t.stump && Math.abs(t.x - a.x) < 6 && a.y < t.y && a.y > t.y - 24)) {
          hit = true
        } else if (this.tile(a.x, a.y + 12) === T.cryptwall) {
          hit = true
        } else {
          const wall = this.solidAt(a.x, a.y + 12)
          if (wall && wall.kind !== 'floor' && !(wall.kind === 'door' && wall.open)) hit = true
        }
      }
      if (!hit && a.left > 0) keep.push(a)
      // La lance retombe là où elle s'arrête (à ramasser).
      else if (a.spear) this.drop('spear', 1, a.x, a.y + 12)
    }
    this.arrows = keep
  }

  // L'autel est-il sur le chemin de `a` à `b` ?
  behindAltar (a, b) {
    for (let k = 1; k < 12; k++) {
      const x = a.x + ((b.x - a.x) * k) / 12
      const y = a.y + ((b.y - a.y) * k) / 12
      if (Math.abs(this.altar.x - x) < 32 && Math.abs(this.altar.y - y) < 20) return true
    }
    return false
  }

  // Va vers `goal` à `speed` (glisse le long d'un obstacle). Renvoie false s'il est bloqué.
  // La ligne droite de a à b est libre (on s'y tient debout tous les tant de pixels).
  clear (a, b) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6)
    for (let k = 1; k <= n; k++) if (!this.walkable(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n)) return false
    return true
  }

  // Où aller pour rejoindre `goal` : tout droit si rien ne gêne, sinon par un chemin case à case (une
  // porte ouverte, le tour d'un mur), cherché à moins de PATH.reach cases et refait de temps en temps.
  // Pas de chemin : tout droit quand même (elle glisse le long de l'obstacle, comme avant).
  toward (b, goal) {
    if (this.clear(b, goal)) {
      b.path = null
      return goal
    }
    const gx = Math.floor(goal.x / TILE)
    const gy = Math.floor(goal.y / TILE)
    const stale = !b.path || this.time - b.pathAt > PATH.every || Math.abs(b.pathGoal[0] - gx) + Math.abs(b.pathGoal[1] - gy) > 1
    if (stale) {
      b.path = this.route(b, goal)
      b.pathAt = this.time
      b.pathGoal = [gx, gy]
    }
    if (!b.path) return goal
    // La prochaine étape, en sautant celles qu'on voit déjà au-delà.
    while (b.path.length > 1 && (Math.hypot(b.path[0].x - b.x, b.path[0].y - b.y) < 6 || this.clear(b, b.path[1]))) b.path.shift()
    if (b.path.length === 1 && Math.hypot(b.path[0].x - b.x, b.path[0].y - b.y) < 6) b.path = null
    return b.path?.[0] ?? goal
  }

  // Le chemin de cases (A*, en huit directions, sans couper les coins) de la bête à `goal` : les milieux
  // des cases, le dernier étant `goal` ; null s'il n'y en a pas assez près.
  route (b, goal) {
    const [bx, by] = [Math.floor(b.x / TILE), Math.floor(b.y / TILE)]
    const [gx, gy] = [Math.floor(goal.x / TILE), Math.floor(goal.y / TILE)]
    if (Math.max(Math.abs(gx - bx), Math.abs(gy - by)) > PATH.reach) return null
    const free = new Map()
    const open = (x, y) => {
      if (Math.max(Math.abs(x - bx), Math.abs(y - by)) > PATH.reach) return false
      if ((x === gx && y === gy) || (x === bx && y === by)) return true
      const k = y * SIDE + x
      if (!free.has(k)) free.set(k, this.walkable((x + 0.5) * TILE, (y + 0.5) * TILE))
      return free.get(k)
    }
    const key = (x, y) => y * SIDE + x
    const h = (x, y) => Math.max(Math.abs(x - gx), Math.abs(y - gy)) + 0.41 * Math.min(Math.abs(x - gx), Math.abs(y - gy))
    const from = new Map([[key(bx, by), null]])
    const cost = new Map([[key(bx, by), 0]])
    // Un tas (les cases à voir, la moins chère d'abord).
    const heap = [[h(bx, by), bx, by]]
    const push = (e) => {
      heap.push(e)
      for (let i = heap.length - 1; i > 0;) {
        const j = (i - 1) >> 1
        if (heap[j][0] <= heap[i][0]) break
        ;[heap[i], heap[j]] = [heap[j], heap[i]]
        i = j
      }
    }
    const pop = () => {
      const top = heap[0]
      const last = heap.pop()
      if (heap.length) {
        heap[0] = last
        for (let i = 0; ;) {
          const [l, r] = [i * 2 + 1, i * 2 + 2]
          let m = i
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r
          if (m === i) break
          ;[heap[i], heap[m]] = [heap[m], heap[i]]
          i = m
        }
      }
      return top
    }
    let seen = 0
    while (heap.length && seen++ < PATH.nodes) {
      const [, x, y] = pop()
      if (x === gx && y === gy) {
        const path = [{ x: goal.x, y: goal.y }]
        for (let k = from.get(key(x, y)); k !== null && k !== key(bx, by); k = from.get(k)) path.unshift({ x: ((k % SIDE) + 0.5) * TILE, y: (Math.floor(k / SIDE) + 0.5) * TILE })
        return path
      }
      const c = cost.get(key(x, y))
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const [nx, ny] = [x + dx, y + dy]
        if (!open(nx, ny) || (dx && dy && (!open(x + dx, y) || !open(x, y + dy)))) continue
        const nc = c + (dx && dy ? 1.41 : 1)
        const k = key(nx, ny)
        if (cost.has(k) && cost.get(k) <= nc) continue
        cost.set(k, nc)
        from.set(k, key(x, y))
        push([nc + h(nx, ny), nx, ny])
      }
    }
    return null
  }

  go (b, goal, speed, dt) {
    const dx = goal.x - b.x
    const dy = goal.y - b.y
    const len = Math.hypot(dx, dy)
    if (len < 2) {
      b.vx = 0
      b.vy = 0
      return true
    }
    const nx = b.x + (dx / len) * speed * dt
    const ny = b.y + (dy / len) * speed * dt
    // Eikthyr passe à travers les arbres, pas à travers son autel.
    const altar = (x, y) => Math.abs(this.altar.x - x) < 28 && Math.abs(this.altar.y - y) < 16
    const ok = (x, y) => (this.cryptAt(x, y) || (x > 20 && y > 20 && x < SIZE - 20 && y < SIZE - 20)) && (b.kind === 'eikthyr' ? this.dry(x, y) && !altar(x, y) : this.walkable(x, y))
    // Sur le côté, pour contourner (vers celui qui rapproche du but).
    const sx = (-dy / len) * speed * dt
    const sy = (dx / len) * speed * dt
    // Bloqué : il contourne par un côté, et s'y tient un moment (sinon il hésite sur place).
    const sideways = () => {
      const [x, y] = [b.x + sx * b.detour, b.y + sy * b.detour]
      if (ok(x, y)) [b.x, b.y] = [x, y]
      else b.detour = -b.detour
    }
    let moved = true
    if (b.detourUntil > this.time) sideways()
    else if (ok(nx, ny)) Object.assign(b, { x: nx, y: ny })
    else if (Math.abs(nx - b.x) > 0.01 && ok(nx, b.y)) b.x = nx
    else if (Math.abs(ny - b.y) > 0.01 && ok(b.x, ny)) b.y = ny
    else if (b.kind === 'eikthyr' || b.state === 'rage') {
      if (!(this.time - (b.detourUntil ?? -99) < 1)) b.detour = this.random() < 0.5 ? 1 : -1
      b.detourUntil = this.time + 0.7
      sideways()
    } else moved = false
    b.vx = (dx / len) * speed
    b.vy = (dy / len) * speed
    if (Math.abs(dx) > Math.abs(dy) * 0.5) b.d = dx < 0 ? 2 : 3
    return moved
  }

  // Eikthyr : il fonce sur le joueur le plus proche, frappe de ses bois, charge, appelle la foudre. Il
  // ne quitte pas les abords de son autel, et repart quand plus personne ne l'affronte.
  eikthyr (b, dt) {
    const t = this.time
    const home = this.altar
    const near = [...this.players.values()].filter((p) => p.alive && dist(p, home) < BOSS.sight)
    if (!near.length) {
      if (t - b.alone > BOSS.giveUp) {
        this.beasts.delete(b.id)
        this.bolts = this.bolts.filter((v) => v.rock)
        this.news.push({ t: 'boss', on: false, killed: false })
        this.news.push({ t: 'fx', k: 'leave', id: b.id, x: Math.round(b.x), y: Math.round(b.y) })
      }
      b.state = 'walk'
      return this.go(b, { x: home.x, y: home.y - 70 }, BOSS.walk, dt)
    }
    b.alone = t
    // Paré : il chancelle un instant.
    if (t < b.stun) {
      b.state = 'idle'
      return
    }
    // Les bois levés : le coup tombe, sur qui est encore là.
    if (b.swing) {
      if (t < b.swing.at) return
      b.swing = null
      b.stomp = t
      this.news.push({ t: 'fx', k: 'stomp', id: b.id, x: Math.round(b.x), y: Math.round(b.y) })
      for (const o of near) if (Math.hypot(o.x - b.x, o.y - b.y) < BOSS.melee.reach + 6) this.damage(o, BOSS.melee.dmg, 'eikthyr', b)
      return
    }
    const target = this.players.get(b.target)
    const p = target?.alive && dist(target, home) < BOSS.sight ? target : near.sort((x, y) => dist(x, b) - dist(y, b))[0]
    b.target = p.id
    // La charge : droit devant, vite ; qui est sur le chemin est touché une fois.
    if (b.state === 'charge') {
      if (t >= b.until) b.state = 'walk'
      else {
        this.go(b, b.dash, BOSS.charge, dt)
        for (const o of near) {
          if (!b.trampled.has(o.id) && Math.hypot(o.x - b.x, o.y - b.y) < 28) {
            b.trampled.add(o.id)
            this.damage(o, BOSS.chargeDmg, 'eikthyr', b)
          }
        }
        return
      }
    }
    if (t >= b.boltAt) {
      b.boltAt = t + between(BOSS.boltEvery, this.random)
      // Un éclair sur chacun (deux au plus), là où il est : il faut bouger.
      for (const o of near.slice(0, 2)) this.bolts.push({ x: o.x, y: o.y, at: t + BOSS.boltDelay })
      b.cast = t
    }
    const d = dist(p, b)
    if (t >= b.chargeAt && d > 80 && d < 360) {
      b.chargeAt = t + between(BOSS.chargeEvery, this.random)
      const len = Math.max(d, 1)
      b.dash = { x: b.x + ((p.x - b.x) / len) * (d + 60), y: b.y + ((p.y - b.y) / len) * (d + 60) }
      Object.assign(b, { state: 'charge', until: t + BOSS.chargeTime, trampled: new Set() })
      this.news.push({ t: 'fx', k: 'charge', id: b.id, x: Math.round(b.x), y: Math.round(b.y) })
      return
    }
    if (d < BOSS.melee.reach) {
      b.vx = 0
      b.vy = 0
      b.d = p.x < b.x ? 2 : 3
      if (t >= b.meleeAt) {
        b.meleeAt = t + BOSS.melee.every
        b.swing = { at: t + BOSS.melee.windup }
      }
      b.state = 'idle'
      return
    }
    // Trop loin de l'autel : il y revient. L'autel entre lui et sa proie : il passe par un coin.
    let goal = dist(b, home) > BOSS.leash ? { x: home.x, y: home.y - 70 } : p
    if (this.behindAltar(b, goal)) {
      const side = b.x < home.x ? -1 : 1
      // Le coin libre le plus près de la proie (pas celui où il est déjà).
      const target = goal
      const corners = [[side, -1], [side, 1]].map(([sx, sy]) => ({ x: home.x + sx * 48, y: home.y + sy * 30 }))
        .filter((c) => dist(b, c) > 6 && !this.behindAltar(b, c))
        .sort((c, d) => dist(c, target) - dist(d, target))
      goal = corners[0] ?? goal
    }
    b.state = 'walk'
    this.go(b, goal, BOSS.walk, dt)
  }

  // La bête lève le bras (le troll sa massue) vers `p` : le coup tombe un instant plus tard, devant elle.
  windup (b, p) {
    const [dx, dy] = [p.x - b.x, p.y - b.y]
    const len = Math.max(Math.hypot(dx, dy), 1)
    const bite = BEASTS[b.kind].hostile ?? BITE
    b.d = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 1 : 0
    b.swing = { at: this.time + bite.windup, target: p.id, x: b.x + (dx / len) * bite.reach * 0.8, y: b.y + (dy / len) * bite.reach * 0.8 }
    b.stomp = this.time
  }

  // Le coup tombe : la proie est touchée si elle est encore à portée (on peut reculer à temps).
  blow (b) {
    const kind = BEASTS[b.kind]
    if (kind.smash) return this.smash(b)
    const bite = kind.hostile ?? BITE
    const p = this.players.get(b.swing.target)
    const thrown = b.swing.thrown
    b.swing = null
    b.bit = this.time
    if (thrown) return p?.alive && this.hurl(b, p)
    if (kind.ranged) return p?.alive && this.loose(b, p)
    if (p?.alive && dist(p, b) < bite.reach + 8) this.damage(p, bite.dmg * this.might(b), b.kind, b)
  }

  // L'archer tire vers sa proie (là où elle est maintenant : en bougeant, on l'évite).
  loose (b, p) {
    const { ranged, hostile } = BEASTS[b.kind]
    const a = Math.atan2(p.y - 10 - (b.y - 14), p.x - b.x)
    this.arrows.push({ x: b.x, y: b.y - 14, vx: Math.cos(a) * ranged.speed, vy: Math.sin(a) * ranged.speed, left: ranged.range + 60, by: null, kind: b.kind, dmg: hostile.dmg * this.might(b), hostile: true })
  }

  // Le nain gris jette un caillou vers sa proie (là où elle est maintenant : en bougeant, on l'évite).
  hurl (b, p) {
    const thr = BEASTS[b.kind].hostile.throw
    const a = Math.atan2(p.y - 10 - (b.y - 16), p.x - b.x)
    this.arrows.push({ x: b.x, y: b.y - 16, vx: Math.cos(a) * thr.speed, vy: Math.sin(a) * thr.speed, left: thr.range, by: null, kind: b.kind, dmg: thr.dmg * this.might(b), hostile: true, stone: true })
  }

  // La massue tombe : qui est dessous est touché, les arbres autour tombent (même les bouleaux).
  smash (b) {
    const kind = BEASTS[b.kind]
    const at = b.swing
    b.swing = null
    b.bit = this.time
    this.news.push({ t: 'fx', k: 'smash', id: b.id, x: Math.round(at.x), y: Math.round(at.y) })
    for (const o of this.players.values()) {
      if (o.alive && Math.hypot(o.x - at.x, o.y - at.y) < kind.smash.radius) this.damage(o, kind.hostile.dmg * this.might(b), b.kind, b)
    }
    for (const tree of this.grid.trees.near(at.x, at.y, kind.smash.trees)) {
      if (!tree.stump && Math.hypot(tree.x - at.x, tree.y - at.y) < kind.smash.trees) this.fell(tree, b)
    }
  }

  // L'élan d'une bête (voir `rush`) : ramassée, elle attend ; puis elle file tout droit (un obstacle
  // l'arrête), et touche une fois qui est sur son chemin.
  dash (b, dt) {
    const r = b.rush
    const rush = BEASTS[b.kind].hostile?.rush ?? BEASTS[b.kind].charge
    b.vx = 0
    b.vy = 0
    if (this.time < r.at) return
    // L'élan fini (ou un obstacle) : la charge du sanglier le fait repartir un peu.
    const done = () => {
      b.rush = null
      if (rush.back) b.back = this.time + rush.back
    }
    if (this.time >= r.until) {
      done()
      b.bit = this.time
      return
    }
    const [x, y] = [b.x + r.ux * rush.speed * dt, b.y + r.uy * rush.speed * dt]
    if (!this.walkable(x, y)) {
      done()
      return
    }
    Object.assign(b, { x, y, vx: r.ux * rush.speed, vy: r.uy * rush.speed })
    if (r.hit) return
    const p = [...this.players.values()].find((o) => o.alive && dist(o, b) < 16 * sizeOf(b))
    if (p) {
      r.hit = true
      this.damage(p, rush.dmg * this.might(b), b.kind, b)
    }
  }

  // Un arbre debout juste devant `b`, sur le chemin de `p` ?
  treeAhead (b, p) {
    const len = Math.max(dist(b, p), 1)
    const x = b.x + ((p.x - b.x) / len) * 20
    const y = b.y + ((p.y - b.y) / len) * 20
    return this.grid.trees.near(x, y, 16).some((t) => !t.stump && Math.hypot(t.x - x, t.y - y) < 16)
  }

  // Nommer un portail (deux du même nom se répondent). null si c'est fait, sinon pourquoi pas.
  name (id, what, text) {
    const p = this.players.get(id)
    const piece = this.pieces.get(what)
    if (!p?.alive || piece?.kind !== 'portal') return 'none'
    if (!this.touching(p, piece)) return 'far'
    piece.name = typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, PORTAL_NAME) : ''
    this.changed.pieces.add(piece.id)
    return null
  }

  // Passer un portail : on arrive devant l'autre portail du même nom.
  travel (p, portal) {
    if (!portal.name) return 'unnamed'
    const other = [...this.pieces.values()].find((o) => o.kind === 'portal' && o.id !== portal.id && o.name === portal.name)
    if (!other) return 'alone'
    const at = [[0, 10], [0, 18], [-20, 10], [20, 10], [0, -22]].map(([dx, dy]) => ({ x: other.x + dx, y: other.y + dy })).find((a) => this.walkable(a.x, a.y))
    if (!at) return 'nowhere'
    Object.assign(p, { x: at.x, y: at.y, moved: this.time })
    this.news.push({ t: 'fx', k: 'portal', x: Math.round(portal.x), y: Math.round(portal.y) })
    this.news.push({ t: 'fx', k: 'portal', x: Math.round(other.x), y: Math.round(other.y) })
    this.news.push({ t: 'moved', player: p.id })
    return null
  }

  // Une bête vit : elle broute et se promène ; le cerf fuit qui s'approche trop ; le sanglier blessé
  // charge ; les grisets et les nains gris foncent sur qui passe près d'eux.
  think (b, dt) {
    const kind = BEASTS[b.kind]
    const bite = kind.hostile ?? BITE
    const t = this.time
    let speed = 0
    let goal = null
    // Étourdie (parée) : elle ne bouge plus.
    if (t < b.stun) {
      b.vx = 0
      b.vy = 0
      return
    }
    if (kind.fixed) return this.summon(b)
    if (b.kind === 'deer' && b.state !== 'flee') {
      const near = [...this.players.values()].find((p) => p.alive && Math.hypot(p.x - b.x, p.y - b.y) < (p.m === 2 ? DEER_HEARS_RUN : DEER_HEARS_WALK))
      if (near) this.scare(b, near)
    }
    if (kind.hostile && b.state !== 'rage' && t >= (b.calm ?? 0)) {
      const prey = [...this.players.values()].filter((p) => p.alive && Math.hypot(p.x - b.x, p.y - b.y) < kind.hostile.sight && this.sees(b, p)).sort((p, q) => dist(p, b) - dist(q, b))[0]
      if (prey) this.enrage(b, prey)
    }
    if (b.state === 'flee') {
      if (t >= b.until) b.state = 'idle'
      else {
        const from = b.flee ?? b
        // Elle file en zigzag : un écart de côté qui change toutes les secondes ou presque.
        if (!(t < b.zigUntil)) {
          b.zig = (this.random() < 0.5 ? -1 : 1) * (0.45 + this.random() * 0.5)
          b.zigUntil = t + 0.6 + this.random() * 0.9
        }
        const a = Math.atan2(b.y - from.y, b.x - from.x) + b.zig + Math.sin(t * 2.1 + b.id) * 0.25
        goal = { x: b.x + Math.cos(a) * 100, y: b.y + Math.sin(a) * 100 }
        speed = kind.run
      }
    } else if (b.state === 'rage') {
      const p = this.players.get(b.target)
      if (b.swing) {
        // Le bras levé (la massue du troll) : elle ne bouge plus jusqu'au coup.
        b.vx = 0
        b.vy = 0
        if (t >= b.swing.at) this.blow(b)
        return
      }
      if (b.rush) return this.dash(b, dt)
      // Le rocher soulevé : il ne bouge plus jusqu'au jet.
      if (b.toss) {
        b.vx = 0
        b.vy = 0
        if (t >= b.toss) b.toss = null
        return
      }
      const toss = kind.hostile?.toss
      const away = p && dist(p, b)
      if (p?.alive && toss && away > toss.min && away < toss.max && t >= (b.tossAt ?? t + 0.5) && this.sees(b, p)) {
        // Il vise où est sa proie : l'endroit se voit au sol, le rocher y tombe un peu plus tard.
        this.bolts.push({ x: p.x, y: p.y, at: t + toss.delay, rock: true, radius: toss.radius, dmg: toss.dmg * this.might(b), from: b.id })
        b.toss = t + toss.windup
        b.tossAt = t + toss.every
        b.d = p.x < b.x ? 2 : 3
        return
      }
      // (Le premier jet, un instant après l'avoir vue.)
      b.tossAt ??= t + 0.5
      // Le caillou du nain gris : d'un peu loin, s'il la voit, le bras levé un instant.
      const thr = kind.hostile?.throw
      if (p?.alive && thr && away > thr.min && away < thr.max && t >= (b.throwAt ?? t + 0.3) && this.sees(b, p) && this.clear(b, p)) {
        b.swing = { at: t + thr.windup, target: p.id, thrown: true }
        b.throwAt = t + thr.every * (0.7 + this.random() * 0.6)
        b.stomp = t
        b.vx = 0
        b.vy = 0
        b.d = p.x < b.x ? 2 : 3
        return
      }
      if (thr) b.throwAt ??= t + 0.3
      const rush = kind.hostile?.rush ?? kind.charge
      const far = p && dist(p, b)
      // Après sa charge, le sanglier s'éloigne (un peu de biais), puis revient.
      if (p?.alive && b.back > t) {
        const a = Math.atan2(b.y - p.y, b.x - p.x) + Math.sin(b.id) * 0.6
        b.until = Math.max(b.until, t + 2)
        if (!this.go(b, { x: b.x + Math.cos(a) * 60, y: b.y + Math.sin(a) * 60 }, kind.run * 0.8, dt)) b.back = t
        return
      }
      if (p?.alive && rush && far > rush.min && far < rush.max && t >= (b.rushAt ?? 0) && this.sees(b, p)) {
        // L'élan : elle se ramasse (on la voit venir), puis file tout droit vers où est sa proie.
        b.rush = { at: t + rush.windup, until: t + rush.windup + rush.time, ux: (p.x - b.x) / far, uy: (p.y - b.y) / far, hit: false }
        b.rushAt = t + rush.every
        b.vx = 0
        b.vy = 0
        b.d = p.x < b.x ? 2 : 3
        return
      }
      if (!p?.alive || t >= b.until) b.state = 'idle'
      else if (b.from && dist(b, b.from) > CHASE_MAX) {
        // Trop loin de chez elle : elle lâche, et rentre.
        Object.assign(b, { state: 'walk', wander: b.from, until: t + CALM_TIME, calm: t + CALM_TIME, target: null })
        goal = b.from
        speed = kind.walk
      } else {
        const d = Math.hypot(p.x - b.x, p.y - b.y)
        // Tant qu'elle voit sa proie, elle ne lâche pas.
        if (kind.hostile && d < kind.hostile.sight * 1.6) b.until = Math.max(b.until, t + 2)
        if (kind.ranged) {
          // L'archer garde ses distances : trop près, il recule ; à portée, il tire.
          if (d < kind.ranged.near) {
            goal = { x: b.x + (b.x - p.x), y: b.y + (b.y - p.y) }
            speed = kind.walk
          } else if (d < kind.ranged.range) {
            b.vx = 0
            b.vy = 0
            b.d = p.x < b.x ? 2 : 3
            if (t - b.bit >= bite.every) this.windup(b, p)
          } else {
            goal = p
            speed = kind.run
          }
        } else if (d < bite.reach) {
          b.vx = 0
          b.vy = 0
          b.d = p.x < b.x ? 2 : 3
          if (t - b.bit >= bite.every) this.windup(b, p)
        } else if (kind.smash && t - b.bit >= bite.every && this.treeAhead(b, p)) {
          // Un arbre entre le troll et sa proie : il le renverse.
          this.windup(b, p)
        } else {
          // Un mur, des arbres entre elle et sa proie : elle cherche un chemin (une porte ouverte).
          goal = this.toward(b, p)
          speed = kind.run
        }
      }
    }
    if (!goal && (b.state === 'idle' || b.state === 'walk' || b.state === 'graze')) {
      if (t >= b.until) {
        const r = this.random()
        b.state = r < 0.45 ? 'graze' : r < 0.8 ? 'walk' : 'idle'
        b.until = t + 2 + this.random() * 4
        // Elle reste dans son pays : sortie, elle rentre vers là où elle est née.
        const toward = (a) => ({ x: b.x + Math.cos(a) * 80, y: b.y + Math.sin(a) * 80 })
        if (!this.homeAt(b, b.x, b.y) && b.den) {
          b.state = 'walk'
          b.wander = toward(Math.atan2(b.den.y - b.y, b.den.x - b.x))
        } else {
          let k = 0
          do b.wander = toward(this.random() * Math.PI * 2)
          while (++k < 6 && !this.homeAt(b, b.wander.x, b.wander.y))
        }
      }
      if (b.state === 'walk') {
        goal = b.wander
        speed = kind.walk
      }
    }
    if (!goal || !speed) {
      if (b.state !== 'rage') {
        b.vx = 0
        b.vy = 0
      }
      return
    }
    if (Math.hypot(goal.x - b.x, goal.y - b.y) < 2) {
      b.vx = 0
      b.vy = 0
      if (b.state === 'walk') b.state = 'idle'
      return
    }
    // Un obstacle : la bête glisse le long, ou change d'idée.
    if (!this.go(b, goal, speed, dt)) {
      if (b.state === 'walk') b.until = t
      else if (b.state === 'flee' && b.flee) b.flee = { x: b.x + (this.random() - 0.5) * 200, y: b.y + (this.random() - 0.5) * 200 }
    }
  }

  // Ce qui dure d'un redémarrage de floor à l'autre : les souches et les arbres arrachés (les arbres
  // viennent de la graine), les rochers cassés, les buissons cueillis, les feux, les constructions et les carottes plantées.
  // Les temps sont gardés en secondes restantes (l'âge, pour une carotte).
  snapshot () {
    const left = (at) => Math.max(0, Math.round(at - this.time))
    return {
      v: VERSION,
      seed: this.seed,
      stumps: [...this.trees.values()].filter((t) => t.stump).map((t) => [t.id]),
      uprooted: [...this.uprooted],
      clock: Math.round(this.clock()),
      rocks: [...this.rocks.values()].filter((k) => k.gone).map((k) => [k.id, left(k.back)]),
      bushes: [...this.bushes.values()].filter((b) => !b.ripe).map((b) => [b.id, left(b.back)]),
      fires: [...this.fires.values()].map((f) => ({ x: f.x, y: f.y, fuel: Math.round(f.fuel), by: f.by })),
      pieces: [...this.pieces.values()].map((p) => ({ k: p.kind, tx: p.tx, ty: p.ty, rot: p.rot, open: p.open, by: p.by, name: p.name, ore: p.queue.map((j) => j.ore), store: p.store, quality: p.quality })),
      crops: [...this.crops.values()].map((c) => [c.tx, c.ty, Math.round(this.time - c.planted), c.kind]),
      grown: [...this.trees.values()].filter((t) => t.grown).map((t) => [t.kind, t.x, t.y, t.stump ? 1 : 0]),
      tilled: [...this.tilled],
      boats: [...this.boats.values()].map((b) => [Math.round(b.x), Math.round(b.y), b.d, b.kind]),
      tombs: [...this.tombs.values()].map((t) => ({ x: t.x, y: t.y, name: t.name, inv: t.inv, quality: t.quality, worn: t.worn, held: t.held }))
    }
  }

  restore (state) {
    if (state?.v !== VERSION) return
    if (Number.isFinite(state.clock)) this.dawn = this.time - state.clock
    for (const [id] of state.stumps ?? []) {
      const tree = this.trees.get(id)
      if (tree) Object.assign(tree, { stump: true, hp: STUMP_HP })
    }
    for (const id of state.uprooted ?? []) {
      const tree = this.trees.get(id)
      if (tree) {
        this.trees.delete(id)
        this.grid.trees.delete(tree)
      }
      this.uprooted.add(id)
    }
    for (const [id, left] of state.rocks ?? []) {
      const rock = this.rocks.get(id)
      if (rock) Object.assign(rock, { gone: true, back: this.time + left })
    }
    for (const [id, left] of state.bushes ?? []) {
      const bush = this.bushes.get(id)
      if (bush) Object.assign(bush, { ripe: false, back: this.time + left })
    }
    for (const f of state.fires ?? []) {
      const id = this.nextId++
      this.fires.set(id, { id, x: f.x, y: f.y, fuel: f.fuel, cooking: [], by: f.by ?? null })
      this.grid.fires.add(this.fires.get(id))
    }
    for (const p of state.pieces ?? []) {
      if (!PIECES[p.k]) continue
      const piece = this.addPiece(p.k, p.tx, p.ty, { rot: p.rot, open: !!p.open, by: p.by ?? null, name: p.name ?? '', store: clean(p.store), quality: clean(p.quality) })
      piece.queue = (p.ore ?? []).filter((o) => SMELTS[o]).map((ore, k) => ({ ore, at: this.time + (k + 1) * SMELT_TIME }))
    }
    for (const k of state.tilled ?? []) if (Number.isInteger(k) && k >= 0 && k < SIDE * SIDE) this.tilled.add(k)
    // (Les carottes d'avant la terre retournée : elle l'est sous elles.)
    for (const [tx, ty, age, kind = 'carrot'] of state.crops ?? []) {
      if (!PLANTS[kind]) continue
      this.addCrop(tx, ty, this.time - age, kind)
      if (PLANTS[kind].tilled) this.tilled.add(ty * SIDE + tx)
    }
    for (const [kind, x, y, stump] of state.grown ?? []) if (TREES[kind]) this.growTree(kind, x, y, !!stump)
    for (const [x, y, d, kind] of state.boats ?? []) this.addBoat(x, y, d, kind)
    for (const t of state.tombs ?? []) {
      const inv = clean(t.inv)
      if (!Object.keys(inv).length) continue
      const id = this.nextId++
      const worn = Object.fromEntries(Object.entries(t.worn ?? {}).filter(([slot, k]) => WEAR[k]?.slot === slot && inv[k]))
      // Une tombe restée dans un donjon (qui ne se garde pas) : devant son mausolée.
      const below = (t.x >= SIZE || t.y >= SIZE) && this.crypts[Math.floor((t.x - CRYPT.band) / CRYPT.stride)]
      if (below) Object.assign(t, this.doorstep(below))
      this.tombs.set(id, { id, x: t.x, y: t.y, name: String(t.name ?? '').slice(0, 32), inv, quality: clean(t.quality), worn, held: inv[t.held] && TOOLS_HELD.has(t.held) ? t.held : null })
    }
    // Les portes d'avant les quarts de tour : de profil quand leur mur va du haut vers le bas (comme le
    // jeu les dessinait).
    const wallish = (i, j) => ['wall', 'door'].includes(this.solid.get(j * SIDE + i)?.kind)
    for (const p of state.pieces ?? []) {
      if (p.k !== 'door' || p.rot !== undefined) continue
      const door = this.solid.get(p.ty * SIDE + p.tx)
      if (door?.kind === 'door' && !wallish(p.tx - 1, p.ty) && !wallish(p.tx + 1, p.ty) && (wallish(p.tx, p.ty - 1) || wallish(p.tx, p.ty + 1))) door.rot = 1
    }
  }

  // Ce qui s'est passé depuis la dernière fois (vidé).
  drain () {
    const news = this.news
    this.news = []
    return news
  }

  // Ce qui a changé dans le monde (arbres, rochers, buissons, objets, feux, constructions, carottes,
  // disparus) depuis la dernière fois (vidé).
  changes () {
    const c = this.changed
    this.changed = this.fresh()
    const of = (set, map) => [...set].map((id) => map.get(id)).filter(Boolean)
    const out = {
      trees: of(c.trees, this.trees),
      grown: of(c.grown, this.trees),
      rocks: of(c.rocks, this.rocks),
      bushes: of(c.bushes, this.bushes),
      items: of(c.items, this.items),
      fires: of(c.fires, this.fires),
      pieces: of(c.pieces, this.pieces),
      crops: of(c.crops, this.crops),
      boats: of(c.boats, this.boats),
      tombs: of(c.tombs, this.tombs),
      props: of(c.props, this.props),
      tilled: [...c.tilled],
      gone: [...c.gone]
    }
    return Object.values(out).some((v) => v.length) ? out : null
  }
}

module.exports = { World, PLANTS, SEEDS, RELIEF, CARRY, STACK, WEIGHT, stackOf, weightOf, cliffs, VERSION, ISLANDS, DAY, NIGHT, RAIN, DRY, CRYPT, PROPS, SPIKES, SPAWNER, STARS, COMBAT, SPEAR, SHIELDED, BOAT, BOATS, CHEST_KINDS, SHIELDS, PARRY, STUN_TIME, CAULDRON_FIRE, TILE, SIDE, SIZE, T, RECIPES, BUILDS, PIECES, CHASE_MAX, UPGRADES, QUALITY_MAX, FOODS, WEAR, BEASTS, TREES, ROCKS, BOSS, BASE_HP, WALK, RUN, GROW, HARVEST, SMELT_TIME, USE_REACH, terrain, seeded, noise, absorb }
