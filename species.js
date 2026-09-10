// Normalized target catalog for the 2026 Reno class project.
// Update only this file when the instructor changes the target list, then bump
// SPECIES_LIST_VERSION. UNKNOWN is an observation type and is not a target here.
export const SPECIES_LIST_VERSION = "reno-2026.1";
export const CATALOG_SOURCE = "data/source/PlantList_InvasivePlants_ClassProject_2026-source.csv";
export const CODE_VERIFICATION_DATE = "2026-09-10";

const USDA_PROFILE = (code) => `https://plants.usda.gov/home/plantProfile?symbol=${code}`;
const USDA_IMAGE_RECORD = (plantId) => `https://plantsservices.sc.egov.usda.gov/api/PlantImages?plantId=${plantId}`;
const USDA_IMAGE_USE = "USDA PLANTS record has Copyright=false; USDA states images without a copyright may be used for any purpose.";

function image(file, alt, creator, provider, sourceTaxon, plantId, extra = {}) {
  return {
    src: `./assets/species/${file}`,
    alt,
    creator,
    provider,
    attribution: `${creator} · ${provider}`,
    sourceTaxon,
    sourceRecord: USDA_IMAGE_RECORD(plantId),
    sourceImage: `https://plants.sc.egov.usda.gov/ImageLibrary/standard/${file}`,
    rights: USDA_IMAGE_USE,
    accessed: CODE_VERIFICATION_DATE,
    modifications: "None; locally stored USDA standard-size derivative.",
    ...extra,
  };
}

function record({ code, plantId, scientificName, commonName, family, nevadaNoxious, instructorNotes = "", aliases = [], duration, growthHabit, traits, lookalikes, seasonal, safety, images = [], additionalSources = [] }) {
  return {
    code,
    codeAuthority: "USDA NRCS PLANTS",
    codeSource: USDA_PROFILE(code),
    codeVerified: CODE_VERIFICATION_DATE,
    plantId,
    scientificName,
    commonName,
    family,
    aliases,
    instructorClassification: {
      nevadaNoxious,
      notes: instructorNotes,
      statement: "Copied from the instructor-supplied catalog; not independently updated as a legal-status claim.",
    },
    duration,
    growthHabit,
    guide: {
      traits,
      lookalikes,
      seasonal,
      safety,
      uncertainty: "Use these as field cues, not a definitive identification. Photograph or record as unknown when uncertain.",
      sources: [
        { label: "USDA NRCS PLANTS profile", url: USDA_PROFILE(code) },
        ...additionalSources,
      ],
      images,
    },
  };
}

export const SPECIES = Object.freeze([
  record({
    code: "SATR12", plantId: 59203, scientificName: "Salsola tragus", commonName: "Russian thistle", family: "Amaranthaceae",
    nevadaNoxious: "N", instructorNotes: "a Nevada Nuisance Weed", aliases: ["tumbleweed", "prickly Russian thistle"], duration: "Annual", growthHabit: "Forb/herb",
    traits: ["Round, much-branched annual at maturity", "Young leaves are narrow and fleshy; later leaves become short and spine-tipped", "Tiny flowers sit in leaf axils", "Dry plants commonly break at the base and tumble"],
    lookalikes: "Kochia and native saltbushes may share the rounded form; check the stiff spine-tipped mature leaves.",
    seasonal: "Green seedlings and soft shoots appear in spring; plants become rigid and dry from late summer into fall.",
    safety: "Mature leaf tips can puncture skin. Wear gloves and eye protection around dry plants.",
    additionalSources: [{ label: "USDA Plant Guide", url: "https://plants.sc.egov.usda.gov/DocumentLibrary/plantguide/pdf/pg_satr12.pdf" }],
    images: [image("sape10_001_svd.jpg", "Botanical line drawing of Russian thistle branching, leaves, and flowers", "Britton, N.L., and A. Brown", "Kentucky Native Plant Society", "Salsola tragus accepted profile; legacy image filename SAPE10", 59203, { year: "1913" })],
  }),
  record({
    code: "COMA2", plantId: 73869, scientificName: "Conium maculatum", commonName: "Poison hemlock", family: "Apiaceae",
    nevadaNoxious: "Y", aliases: ["poison-hemlock"], duration: "Biennial", growthHabit: "Forb/herb",
    traits: ["Tall, smooth, hollow stems with irregular purple blotches", "Large fernlike leaves divided into many leaflets", "Many small white flowers in umbrella-shaped clusters", "First-year plants form a leafy basal rosette"],
    lookalikes: "Wild carrot usually has hairy green stems. Water hemlock is also highly poisonous; do not handle either plant to compare them.",
    seasonal: "Rosettes may persist through cool weather; flowering stems are most visible in late spring and early summer.",
    safety: "DEADLY POISONOUS. Do not taste, crush, or closely smell any part. Avoid bare-skin contact and use photographs for confirmation.",
    images: [
      image("coma2_002_svp.jpg", "Botanical illustration of poison hemlock leaves, stem, and flower cluster", "William & Wilma Follette, USDA NRCS", "USDA NRCS Wetland Science Institute", "Conium maculatum", 73869, { year: "1992" }),
      image("coma2_004_shp.jpg", "Poison hemlock seeds photographed against a measurement background", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Conium maculatum", 73869, { location: "Nevada" }),
    ],
  }),
  record({
    code: "CANU4", plantId: 33072, scientificName: "Carduus nutans", commonName: "Musk thistle", family: "Asteraceae",
    nevadaNoxious: "Y", aliases: ["nodding thistle", "nodding plumeless thistle"], duration: "Biennial or short-lived perennial", growthHabit: "Forb/herb",
    traits: ["Large rose-purple flower heads usually nod at maturity", "Stems have narrow spiny wings below the heads", "Dark-green leaves are deeply lobed with pale sharp tips", "Rosettes are broad and relatively smooth or waxy above"],
    lookalikes: "Bull thistle heads usually stay upright and its leaves are rougher; Scotch thistle is densely woolly and silver-gray.",
    seasonal: "Usually a rosette the first year, then bolts and flowers from late spring through summer.",
    safety: "Sharp spines can pierce gloves and clothing; avoid brushing against flower heads and leaves.",
    images: [image("canu4_001_svd.jpg", "Botanical line drawing of musk thistle rosette, winged stem, and nodding head", "Britton, N.L., and A. Brown", "Kentucky Native Plant Society", "Carduus nutans", 33072, { year: "1913" })],
  }),
  record({
    code: "CESO3", plantId: 33133, scientificName: "Centaurea solstitialis", commonName: "Yellow starthistle", family: "Asteraceae",
    nevadaNoxious: "Y", aliases: ["yellow star-thistle"], duration: "Annual", growthHabit: "Forb/herb",
    traits: ["Bright yellow flower heads surrounded by long straw-colored spines", "Gray-green stems have distinct leaflike wings", "Lower leaves are deeply lobed; upper leaves are narrow and entire", "Mature plants branch into a stiff open framework"],
    lookalikes: "Other yellow-flowered composites lack the star of long rigid spines around each head.",
    seasonal: "Seedlings form winter or spring rosettes; flowering is most obvious in summer and can continue into fall.",
    safety: "Flower-head spines are hazardous. The plant is toxic to horses when eaten in quantity; never use survey plants as forage.",
    additionalSources: [{ label: "USDA Plant Guide", url: "https://plants.sc.egov.usda.gov/DocumentLibrary/plantguide/pdf/pg_ceso3.pdf" }],
    images: [image("ceso3_001_svd.jpg", "Botanical line drawing of yellow starthistle stem, leaves, and spiny flower head", "Britton, N.L., and A. Brown", "Kentucky Native Plant Society", "Centaurea solstitialis", 33133, { year: "1913" })],
  }),
  record({
    code: "CEDI3", plantId: 33165, scientificName: "Centaurea diffusa", commonName: "Diffuse knapweed", family: "Asteraceae",
    nevadaNoxious: "Y", aliases: ["white knapweed"], duration: "Annual to short-lived perennial", growthHabit: "Forb/herb",
    traits: ["Many branches produce a rounded or tumbleweed-like outline", "Small heads usually have white to pale pink flowers", "Head bracts end in slender spreading spines", "Leaves are gray-green; lower leaves are more deeply divided than upper leaves"],
    lookalikes: "Spotted knapweed usually has black-tipped bracts rather than a comb of slender spreading spines.",
    seasonal: "Rosettes appear in cool seasons; branching stems and pale heads are most visible in summer.",
    safety: "Bract tips can scratch. Wear gloves and record an unknown if the bracts cannot be seen clearly.",
    images: [],
  }),
  record({
    code: "CIIN", plantId: 33521, scientificName: "Cichorium intybus", commonName: "Chicory", family: "Asteraceae",
    nevadaNoxious: "N", instructorNotes: "a Nevada Nuisance Weed", aliases: ["succory", "French endive"], duration: "Biennial or perennial", growthHabit: "Forb/herb",
    traits: ["Sky-blue ray flowers occur directly along stiff branching stems", "Basal leaves are deeply toothed and resemble dandelion leaves", "Upper stems carry few, small clasping leaves", "Broken tissues exude milky sap"],
    lookalikes: "Dandelions lack the tall wiry branching stem; several native composites have blue flowers but not the same nearly leafless architecture.",
    seasonal: "Rosettes are easiest to see in spring; flowers open in summer and often close later in the day.",
    safety: "Milky sap may irritate sensitive skin. Do not taste plants used for survey identification.",
    images: [
      image("ciin_002_shp.jpg", "Chicory flowering head and stem photographed in Nevada", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Cichorium intybus", 33521, { location: "Nevada" }),
      image("ciin_001_svd.jpg", "Botanical line drawing of chicory root, leaves, stem, and flower", "Britton, N.L., and A. Brown", "Kentucky Native Plant Society", "Cichorium intybus", 33521, { year: "1913" }),
    ],
  }),
  record({
    code: "CIVU", plantId: 33818, scientificName: "Cirsium vulgare", commonName: "Bull thistle", family: "Asteraceae",
    nevadaNoxious: "N", instructorNotes: "a Nevada Nuisance Weed", aliases: ["spear thistle"], duration: "Biennial", growthHabit: "Forb/herb",
    traits: ["Leaves are deeply lobed, coarse above, and woolly beneath", "Broad spiny wings run down much of the stem", "Large purple heads are upright rather than strongly nodding", "Rosettes have a raised, rough leaf surface and stout yellowish spines"],
    lookalikes: "Musk thistle usually has smoother leaves and nodding heads; Scotch thistle is much more densely woolly and silvery.",
    seasonal: "First-year rosettes overwinter; flowering stalks appear from summer into early fall.",
    safety: "Very sharp leaf and stem spines. Keep hands and faces away; use sturdy gloves.",
    images: [
      image("civu_003_shp.jpg", "Bull thistle seed and floral material photographed from a Nevada specimen", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Cirsium vulgare", 33818, { location: "Nevada" }),
      image("cila8_001_svd.jpg", "Botanical line drawing associated by USDA with the accepted bull thistle profile", "Britton, N.L., and A. Brown", "Kentucky Native Plant Society", "Cirsium vulgare accepted profile; legacy image filename CILA8", 33818, { year: "1913" }),
    ],
  }),
  record({
    code: "CIAR4", plantId: 33539, scientificName: "Cirsium arvense", commonName: "Canada thistle", family: "Asteraceae",
    nevadaNoxious: "Y", aliases: ["creeping thistle"], duration: "Perennial", growthHabit: "Forb/herb",
    traits: ["Creeping roots produce dense patches of connected shoots", "Numerous small lavender to purple heads occur in clusters", "Leaves are irregularly lobed with spiny margins", "Stems are slender and generally lack the broad spiny wings of bull thistle"],
    lookalikes: "Native thistles commonly have larger heads and do not form the same extensive clonal patches; confirm before recording.",
    seasonal: "Shoots emerge in spring; clustered flowers are most visible in early to midsummer.",
    safety: "Leaf margins are spiny. Wear gloves and avoid trampling patches, which can spread fragments.",
    images: [
      image("ciar4_002_shp.jpg", "Canada thistle flowering shoot", "Robert H. Mohlenbrock, USDA NRCS", "USDA NRCS Wetland Science Institute", "Cirsium arvense", 33539, { year: "1992" }),
      image("ciar4_005_shp.jpg", "Canada thistle seed photographed against a measurement background", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Cirsium arvense", 33539),
    ],
  }),
  record({
    code: "ONAC", plantId: 38237, scientificName: "Onopordum acanthium", commonName: "Scotch thistle", family: "Asteraceae",
    nevadaNoxious: "Y", aliases: ["Scotch cottonthistle"], duration: "Biennial", growthHabit: "Forb/herb",
    traits: ["Entire plant appears silvery gray from dense woolly hairs", "Broad spiny wings extend continuously down stout stems", "Very large, deeply lobed leaves have prominent pale veins", "Purple flower heads occur singly or in small clusters"],
    lookalikes: "Bull and musk thistles are greener and less densely woolly; verify the broad silvery stem wings.",
    seasonal: "Rosettes can be large by spring; towering flowering stems develop in summer.",
    safety: "Large rigid spines can penetrate clothing. Keep a safe distance and photograph rather than handling.",
    images: [
      image("onac_004_shp.jpg", "Scotch thistle seed photographed against a measurement background", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Onopordum acanthium", 38237, { location: "Utah" }),
      image("onac_001_svd.jpg", "Botanical line drawing of Scotch thistle leaves, winged stem, and flower head", "Britton, N.L., and A. Brown", "Kentucky Native Plant Society", "Onopordum acanthium", 38237, { year: "1913" }),
    ],
  }),
  record({
    code: "CHTE2", plantId: 62607, scientificName: "Chorispora tenella", commonName: "Blue mustard", family: "Brassicaceae",
    nevadaNoxious: "Y", aliases: ["crossflower", "purple mustard"], duration: "Annual", growthHabit: "Forb/herb",
    traits: ["Four-petaled lavender to purple flowers form a cross", "Petals often show darker purple veins", "Basal and lower leaves have wavy or shallowly toothed margins", "Long narrow seed pods turn upward from the stem"],
    lookalikes: "Other purple-flowered mustards can look similar; check flower color, wavy leaves, and the form of mature seed pods.",
    seasonal: "A cool-season annual, often flowering early in spring before many other trail weeds.",
    safety: "No special handling is needed for a photo survey, but do not taste plants and avoid spreading mature seed pods.",
    images: [image("chte2_1h.jpg", "Herbarium specimen of blue mustard showing leaves, flowers, and fruits", "Creator not listed", "Smithsonian Institution, Department of Botany", "Chorispora tenella", 62607)],
  }),
  record({
    code: "LELA2", plantId: 63313, scientificName: "Lepidium latifolium", commonName: "Perennial pepperweed", family: "Brassicaceae",
    nevadaNoxious: "Y", instructorNotes: "tall whitetop", aliases: ["tall whitetop", "broadleaved pepperweed"], duration: "Perennial", growthHabit: "Forb/herb",
    traits: ["Tall stems support dense rounded sprays of tiny white flowers", "Leaves are waxy, lance-shaped, and usually do not clasp the stem", "Lower leaves are larger and may have toothed edges", "Spreading roots form broad, dense patches"],
    lookalikes: "Hoary cress is usually shorter and its upper leaves clasp the stem; compare mature leaves and seed pods.",
    seasonal: "Shoots emerge in spring; white flower canopies are conspicuous in early to midsummer.",
    safety: "Avoid moving root fragments or seed. Gloves are recommended when working through dense stands.",
    images: [image("lela2_001_shp.jpg", "Perennial pepperweed seed photographed against a measurement background", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Lepidium latifolium", 63313, { location: "Colorado" })],
  }),
  record({
    code: "LEDR", plantId: 62552, scientificName: "Lepidium draba", commonName: "Hoary cress", family: "Brassicaceae",
    nevadaNoxious: "Y", instructorNotes: "formerly, Cardaria draba", aliases: ["whitetop", "Cardaria draba"], duration: "Perennial", growthHabit: "Forb/herb",
    traits: ["Flat-topped clusters of many tiny white four-petaled flowers", "Upper leaves broadly clasp the stem", "Gray-green leaves are oval to lance-shaped with uneven margins", "Mature pods are inflated and heart-shaped"],
    lookalikes: "Perennial pepperweed is commonly taller, has more elongated nonclasping leaves, and produces different small pods.",
    seasonal: "Dense colonies green up early and usually flower in spring to early summer.",
    safety: "Do not pull plants during a survey; root fragments can produce new plants.",
    images: [image("ledr_001_svd.jpg", "Botanical line drawing of hoary cress roots, clasping leaves, flowers, and pods", "Britton, N.L., and A. Brown", "Kentucky Native Plant Society", "Lepidium draba", 62552, { year: "1913" })],
  }),
  record({
    code: "ELAN", plantId: 86992, scientificName: "Elaeagnus angustifolia", commonName: "Russian olive", family: "Elaeagnaceae",
    nevadaNoxious: "Y", aliases: ["oleaster"], duration: "Perennial", growthHabit: "Shrub or tree",
    traits: ["Narrow leaves are silvery on both surfaces from tiny scales", "Young twigs are also silvery and may end in stout thorns", "Small fragrant yellow flowers are tubular with four lobes", "Fruits are olive-shaped and become yellow to silvery tan"],
    lookalikes: "Willows lack the dense silver scales and olive-like fruits; buffaloberry has different leaf arrangement and fruit color.",
    seasonal: "Flowers appear in late spring; fruits mature later in summer and fall while silvery foliage remains conspicuous.",
    safety: "Branches may have thorns. Watch footing and eye level around dense streamside growth.",
    additionalSources: [{ label: "USDA Plant Guide", url: "https://plants.sc.egov.usda.gov/DocumentLibrary/plantguide/pdf/pg_elan.pdf" }],
    images: [
      image("elan_006_svp.jpg", "Whole Russian olive tree showing its pale silvery crown", "Herman, D.E., et al.", "North Dakota State Soil Conservation Committee", "Elaeagnus angustifolia", 86992, { location: "North Dakota" }),
      image("elan_007_shp.jpg", "Russian olive twig with narrow silvery leaves and olive-shaped fruits", "Herman, D.E., et al.", "North Dakota State Soil Conservation Committee", "Elaeagnus angustifolia", 86992, { location: "North Dakota" }),
    ],
  }),
  record({
    code: "AECY", plantId: 20033, scientificName: "Aegilops cylindrica", commonName: "Jointed goatgrass", family: "Poaceae",
    nevadaNoxious: "Y", aliases: ["jointed goat grass"], duration: "Annual", growthHabit: "Grass",
    traits: ["Seed head is a narrow cylinder made of stacked joints", "Each hard joint contains spikelets and separates at maturity", "Upper joints end in long straight awns", "Leaves and sheaths may be sparsely hairy"],
    lookalikes: "Wheat spikes do not break into the same barrel-like joints; examine only mature heads and avoid pulling plants.",
    seasonal: "Winter annual growth is green in spring; jointed heads become obvious in early summer and then dry tan.",
    safety: "Dry awns can lodge in clothing and irritate skin or animal eyes. Handle with gloves.",
    images: [
      image("aecy_002_shp.jpg", "Jointed goatgrass spikelet joints photographed against a measurement background", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Aegilops cylindrica", 20033),
      image("aecy_001_svd.jpg", "Botanical line drawing of jointed goatgrass seed head and joints", "A.S. Hitchcock, revised by A. Chase", "USDA", "Aegilops cylindrica", 20033, { year: "1950" }),
    ],
  }),
  record({
    code: "BRTE", plantId: 21078, scientificName: "Bromus tectorum", commonName: "Cheatgrass", family: "Poaceae",
    nevadaNoxious: "N", instructorNotes: "downy brome", aliases: ["downy brome"], duration: "Annual", growthHabit: "Grass",
    traits: ["Open seed heads droop to one side as they mature", "Leaf blades and sheaths are softly hairy", "Spikelets carry long straight awns", "Plants turn reddish purple and then straw-colored early in the dry season"],
    lookalikes: "Other annual bromes occur locally; compare hairiness, drooping panicle, and spikelet structure before confirming.",
    seasonal: "Often germinates in fall, greens up very early in spring, sets seed, and dries before many perennial grasses.",
    safety: "Dry awns can irritate skin and injure pets. Dense cured stands also carry fire readily.",
    additionalSources: [{ label: "USDA Plant Guide", url: "https://plants.sc.egov.usda.gov/DocumentLibrary/plantguide/pdf/pg_brte.pdf" }],
    images: [
      image("brte_006_shp.jpg", "Cheatgrass florets and awns photographed against a measurement background", "Jose Hernandez", "USDA ARS Systematic Botany and Mycology Laboratory", "Bromus tectorum", 21078, { location: "Arizona" }),
      image("brte_007_shp.jpg", "Cheatgrass leaves and emerging seed heads in the field", "Cassondra Skinner", "USDI Bureau of Land Management", "Bromus tectorum", 21078, { location: "Idaho", year: "2007" }),
    ],
  }),
  record({
    code: "POBU", plantId: 24897, scientificName: "Poa bulbosa", commonName: "Bulbous bluegrass", family: "Poaceae",
    nevadaNoxious: "N", aliases: ["bulbous meadowgrass"], duration: "Perennial", growthHabit: "Grass",
    traits: ["Stem bases are swollen into small onionlike bulbs", "Seed heads often bear tiny green or purple bulbils instead of ordinary seed", "Leaves are narrow with boat-shaped tips", "Plants form short dense tufts"],
    lookalikes: "Kentucky bluegrass lacks the enlarged basal bulbs and the conspicuous bulbils in the panicle.",
    seasonal: "Grows early and forms bulbils in spring, then commonly becomes dormant and straw-colored by early summer.",
    safety: "No special contact hazard; avoid dislodging bulbils into uninfested cells.",
    additionalSources: [{ label: "USDA Plant Guide", url: "https://plants.sc.egov.usda.gov/DocumentLibrary/plantguide/pdf/pg_pobu.pdf" }],
    images: [
      image("pobu_007_svp.jpg", "Bulbous bluegrass tuft in field habitat", "Sheri Hagwood", "USDA PLANTS contributor; Idaho BLM location record", "Poa bulbosa", 24897, { location: "Idaho" }),
      image("pobu_009_svp.jpg", "Bulbous bluegrass flowering clump", "C. Kenneth Pearse", "USDA Forest Service", "Poa bulbosa", 24897, { location: "Utah" }),
    ],
  }),
  record({
    code: "TACA8", plantId: 25969, scientificName: "Taeniatherum caput-medusae", commonName: "Medusahead", family: "Poaceae",
    nevadaNoxious: "Y", aliases: ["medusahead rye"], duration: "Annual", growthHabit: "Grass",
    traits: ["Dense narrow head carries extremely long twisting awns", "Awns spread at maturity to create a Medusa-like outline", "Leaf blades feel rough and remain narrow", "Mature plants cure to pale straw while stiff heads persist"],
    lookalikes: "Squirreltail and foxtail barley can also be long-awned; medusahead has a denser head with stiff, twisted awns.",
    seasonal: "A winter annual that heads in late spring to early summer and can remain green slightly later than nearby cheatgrass.",
    safety: "Sharp awns can injure eyes, skin, and animals. Do not handle mature heads bare-handed.",
    additionalSources: [{ label: "USDA Plant Guide", url: "https://plants.sc.egov.usda.gov/DocumentLibrary/plantguide/pdf/pg_taca8.pdf" }],
    images: [
      image("taca8_001_shp.jpg", "Medusahead florets with long awns photographed against a measurement background", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Taeniatherum caput-medusae", 25969),
      image("elca13_001_shd.jpg", "Botanical detail of medusahead spikelet and long twisted awns", "A.S. Hitchcock, revised by A. Chase", "USDA", "Taeniatherum caput-medusae accepted profile; historical Elymus filename", 25969, { year: "1950" }),
    ],
  }),
  record({
    code: "CETE5", plantId: 72725, scientificName: "Ceratocephala testiculata", commonName: "Bur buttercup", family: "Ranunculaceae",
    nevadaNoxious: "N", instructorNotes: "a Nevada Nuisance Weed", aliases: ["curveseed butterwort", "hornseed buttercup"], duration: "Annual", growthHabit: "Forb/herb",
    traits: ["Very low plant with a small basal rosette", "Leaves are deeply divided into narrow lobes", "Tiny yellow flowers usually have five petals", "Mature fruit forms a compact cluster of hooked or spiny beaks"],
    lookalikes: "Other buttercups may have yellow flowers, but the low habit and hard spiny fruit are distinctive when mature.",
    seasonal: "One of the earliest spring annuals; plants can flower, fruit, and dry before summer.",
    safety: "Buttercups can irritate skin and mouth, and the burr is sharp. Do not taste; use gloves around mature fruit.",
    images: [
      image("cete5_003_shp.jpg", "Bur buttercup plant showing low divided leaves and yellow flower", "Sheri Hagwood", "USDA PLANTS contributor; Idaho BLM location record", "Ceratocephala testiculata", 72725, { location: "Idaho", year: "2006" }),
      image("cete5_004_shp.jpg", "Bur buttercup colony in early spring field habitat", "Sheri Hagwood", "USDA PLANTS contributor; Idaho BLM location record", "Ceratocephala testiculata", 72725, { location: "Idaho", year: "2005" }),
    ],
  }),
  record({
    code: "VETH", plantId: 52573, scientificName: "Verbascum thapsus", commonName: "Common mullein", family: "Scrophulariaceae",
    nevadaNoxious: "N", instructorNotes: "a Nevada Nuisance Weed", aliases: ["great mullein"], duration: "Biennial", growthHabit: "Forb/herb",
    traits: ["First-year rosette has very large, densely woolly gray-green leaves", "Second-year plant sends up one tall candlelike flower spike", "Yellow five-lobed flowers open along the spike", "Stem leaves run slightly down the stem, giving it a winged look"],
    lookalikes: "Other Verbascum species may be present; confirm the dense wool, leaf attachment, and unbranched spike.",
    seasonal: "Rosettes can persist year-round; flowering spikes are most visible through summer.",
    safety: "Leaf hairs can irritate skin, eyes, and airways. Do not rub eyes after touching and avoid handling in wind.",
    images: [
      image("veth_005_shp.jpg", "Common mullein flowering spike and woolly leaves", "Clarence A. Rechenthin", "USDA NRCS East Texas Plant Materials Center", "Verbascum thapsus", 52573, { location: "Texas" }),
      image("veth_012_shp.jpg", "Common mullein seed and floral material photographed against a measurement background", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Verbascum thapsus", 52573, { location: "District of Columbia" }),
    ],
  }),
  record({
    code: "AIAL", plantId: 93819, scientificName: "Ailanthus altissima", commonName: "Tree-of-heaven", family: "Simaroubaceae",
    nevadaNoxious: "N", aliases: ["tree of heaven", "ailanthus"], duration: "Perennial", growthHabit: "Tree",
    traits: ["Very large compound leaves hold many long leaflets", "Each leaflet has one or a few gland-tipped teeth near its base", "Clusters of flat twisted samaras become tan to reddish", "Smooth young bark and rapid root sprouts are common"],
    lookalikes: "Walnuts and sumacs have teeth along much of each leaflet margin and lack the paired basal glands.",
    seasonal: "Leaves emerge in spring; flowers and samara clusters develop in summer, while root sprouts may appear all season.",
    safety: "Sap can cause dermatitis. Wear gloves and do not crush leaves to test the often unpleasant odor.",
    images: [
      image("aial_031_shp.jpg", "Tree-of-heaven twig with compound leaves and developing samaras", "Doug Goldman", "USDA NRCS National Plants Data Team", "Ailanthus altissima", 93819, { location: "North Carolina", year: "2012" }),
      image("aial_002_shp.jpg", "Tree-of-heaven samaras photographed against a measurement background", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Ailanthus altissima", 93819),
    ],
  }),
  record({
    code: "TAMAR2", plantId: 69416, scientificName: "Tamarix spp.", commonName: "Tamarisk / saltcedar", family: "Tamaricaceae",
    nevadaNoxious: "Y", aliases: ["saltcedar", "salt cedar", "Tamarix"], duration: "Perennial", growthHabit: "Shrub or tree",
    traits: ["Minute scale-like leaves overlap along very slender green twigs", "Feathery sprays carry many tiny pink to white flowers", "Older bark becomes reddish brown and furrowed", "Plants often form dense stands along water or saline ground"],
    lookalikes: "Junipers have cones or berry-like structures and stiffer foliage; native Baccharis has broader leaves and composite flower heads.",
    seasonal: "Fine green twigs leaf out in spring; flower sprays may appear from spring through summer depending on the species or hybrid.",
    safety: "Identification is intentionally at genus level because local Tamarix species hybridize. Watch for rough branches and unstable streambanks.",
    images: [
      image("tamar2_002_svp.jpg", "Historical photograph of a Tamarix shrub", "E.R. Mosher", "USDA Forest Service", "Tamarix genus", 69416, { year: "1914" }),
      image("tamar2_001_svd.jpg", "Botanical line drawing of Tamarix twig, scale leaves, flowers, and seed", "Creator not listed", "USDA Forest Service", "Tamarix genus", 69416),
    ],
  }),
  record({
    code: "ULPU", plantId: 71003, scientificName: "Ulmus pumila", commonName: "Siberian elm", family: "Ulmaceae",
    nevadaNoxious: "N", aliases: ["Asiatic elm"], duration: "Perennial", growthHabit: "Shrub or tree",
    traits: ["Small oval leaves have a single-toothed margin and a nearly even base", "Twigs are slender with small dark buds", "Round papery samaras have the seed near the center and a notch at the tip", "Open-grown trees often have brittle spreading branches"],
    lookalikes: "American elm usually has larger, rougher, double-toothed leaves with a more strongly uneven base.",
    seasonal: "Flowers and samaras appear very early in spring before or with new leaves; foliage remains through summer.",
    safety: "Do not stand beneath visibly broken or hanging limbs, especially in wind.",
    additionalSources: [{ label: "USDA Plant Guide", url: "https://plants.sc.egov.usda.gov/DocumentLibrary/plantguide/pdf/pg_ulpu.pdf" }],
    images: [
      image("ulpu_001_svp.jpg", "Whole Siberian elm tree", "Herman, D.E., et al.", "North Dakota State Soil Conservation Committee", "Ulmus pumila", 71003, { location: "North Dakota" }),
      image("ulpu_002_shp.jpg", "Siberian elm twig and small toothed leaves", "Herman, D.E., et al.", "North Dakota State Soil Conservation Committee", "Ulmus pumila", 71003, { location: "North Dakota" }),
    ],
  }),
  record({
    code: "TRTE", plantId: 93916, scientificName: "Tribulus terrestris", commonName: "Puncturevine", family: "Zygophyllaceae",
    nevadaNoxious: "Y", aliases: ["goathead", "goat's-head"], duration: "Annual", growthHabit: "Forb/herb",
    traits: ["Prostrate stems radiate from a central crown", "Opposite compound leaves have several pairs of small hairy leaflets", "Small yellow flowers have five petals", "Hard fruits split into wedge-shaped burs armed with stout spines"],
    lookalikes: "Purslane has fleshy leaves; native Kallstroemia can have similar leaves and yellow flowers but a differently shaped fruit.",
    seasonal: "Germinates in warm weather, flowers through summer, and leaves persistent spiny burs after the plant dries.",
    safety: "Burs puncture shoes, tires, skin, and animal paws. Wear closed footwear and never pick up mature fruits bare-handed.",
    images: [
      image("trte_003_shp.jpg", "Puncturevine burs photographed against a measurement background", "Steve Hurst", "USDA ARS Systematic Botany and Mycology Laboratory", "Tribulus terrestris", 93916),
      image("trte_001_svd.jpg", "Botanical line drawing of puncturevine prostrate stem, leaves, flower, and burr", "Britton, N.L., and A. Brown", "Kentucky Native Plant Society", "Tribulus terrestris", 93916, { year: "1913" }),
    ],
  }),
]);

export const SPECIES_BY_CODE = new Map(SPECIES.map((item) => [item.code, item]));

export function validateSpeciesList(species = SPECIES) {
  const errors = [];
  const seen = new Set();
  if (species.length !== 23) errors.push(`Expected exactly 23 target entries; found ${species.length}.`);
  for (const [index, item] of species.entries()) {
    const code = String(item.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,10}$/.test(code)) errors.push(`Species ${index + 1} has an invalid code.`);
    if (seen.has(code)) errors.push(`Duplicate species code: ${code}.`);
    seen.add(code);
    if (!String(item.scientificName || "").trim()) errors.push(`${code || `Species ${index + 1}`} needs a scientific name.`);
    if (!String(item.commonName || "").trim()) errors.push(`${code || `Species ${index + 1}`} needs a common name.`);
    if (!String(item.family || "").trim()) errors.push(`${code || `Species ${index + 1}`} needs a family.`);
    if (item.codeAuthority !== "USDA NRCS PLANTS" || !item.codeSource || !item.codeVerified) errors.push(`${code} needs verified code provenance.`);
    if (!["Y", "N"].includes(item.instructorClassification?.nevadaNoxious)) errors.push(`${code} needs the instructor Y/N classification.`);
    if (!Array.isArray(item.guide?.traits) || item.guide.traits.length < 3 || item.guide.traits.length > 5) errors.push(`${code} needs 3-5 field traits.`);
    if (!item.guide?.lookalikes || !item.guide?.seasonal || !item.guide?.safety) errors.push(`${code} has an incomplete guide card.`);
    for (const photo of item.guide?.images || []) {
      if (!photo.src || !photo.alt || !photo.sourceRecord || !photo.rights || !photo.sourceTaxon) errors.push(`${code} has incomplete image provenance.`);
    }
  }
  if (seen.has("UNKNOWN")) errors.push("UNKNOWN must remain an administrative observation type, not a target species.");
  return errors;
}
