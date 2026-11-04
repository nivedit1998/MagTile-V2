// Bundled starter content for Hangman, Word Rush and Charades. Words and short action phrases
// are original; film and show entries are factual titles with year and language metadata
// (no posters, artwork, descriptions or third-party card decks). Bump BANK_VERSION when any
// pool changes, because saved draw orders are tied to pool contents.

export const BANK_VERSION = 1

export interface Card {
  /** Stable within a category: `${categoryId}:${n}`. */
  id: string
  text: string
  /** Optional detail shown small, e.g. "1999 · English". */
  meta?: string
}

export interface Category {
  id: string
  name: string
  cards: readonly Card[]
}

function words(id: string, name: string, list: string): Category {
  return { id, name, cards: list.split(',').map((w, i) => ({ id: `${id}:${i}`, text: w.trim() })) }
}

function titles(id: string, name: string, rows: readonly (readonly [string, string])[]): Category {
  return { id, name, cards: rows.map(([text, meta], i) => ({ id: `${id}:${i}`, text, meta })) }
}

/** Plain-word categories (Hangman and Word Rush). */
export const WORD_CATEGORIES: readonly Category[] = [
  words('animals', 'Animals', 'Elephant,Giraffe,Penguin,Kangaroo,Dolphin,Octopus,Butterfly,Crocodile,Hedgehog,Flamingo,Squirrel,Peacock,Tortoise,Seahorse,Cheetah,Scorpion,Hamster,Pelican,Chameleon,Jellyfish,Woodpecker,Platypus,Antelope,Armadillo,Gorilla,Lobster,Parrot,Raccoon,Starfish,Walrus'),
  words('food', 'Food & drink', 'Pancake,Spaghetti,Sandwich,Chocolate,Popcorn,Strawberry,Cucumber,Lemonade,Dumpling,Pineapple,Omelette,Noodles,Biscuit,Avocado,Cinnamon,Meatball,Pretzel,Smoothie,Cauliflower,Marshmallow,Croissant,Watermelon,Porridge,Mushroom,Hamburger,Cornflakes,Gingerbread,Sausage,Blueberry,Lasagne'),
  words('places', 'Places', 'Library,Airport,Hospital,Lighthouse,Volcano,Waterfall,Pyramid,Museum,Stadium,Harbour,Desert,Castle,Rainforest,Bakery,Playground,Mountain,Island,Greenhouse,Aquarium,Tunnel,Farmhouse,Railway,Market,Canyon,Observatory,Theatre,Lagoon,Monastery,Campsite,Skyscraper'),
  words('jobs', 'Jobs', 'Plumber,Firefighter,Architect,Pilot,Dentist,Carpenter,Journalist,Astronaut,Electrician,Librarian,Chef,Mechanic,Photographer,Pharmacist,Farmer,Teacher,Sailor,Detective,Tailor,Surgeon,Lifeguard,Baker,Translator,Gardener,Postman,Scientist,Barber,Cashier,Engineer,Veterinarian'),
  words('sports', 'Sports & games', 'Football,Cricket,Badminton,Swimming,Basketball,Volleyball,Archery,Wrestling,Gymnastics,Marathon,Snooker,Skateboard,Hockey,Rowing,Cycling,Climbing,Fencing,Bowling,Surfing,Skiing,Tennis,Boxing,Chess,Dominoes,Darts,Javelin,Handball,Rugby,Karate,Snowboard'),
  words('objects', 'Home & objects', 'Umbrella,Telescope,Blanket,Candle,Backpack,Notebook,Scissors,Toothbrush,Lantern,Hammer,Mirror,Teapot,Suitcase,Keyboard,Calendar,Envelope,Pillow,Doorbell,Ladder,Compass,Battery,Spectacles,Wardrobe,Thermometer,Staircase,Flashlight,Magnet,Bookshelf,Stapler,Hairbrush'),
]

/** Charades categories: original action phrases plus factual film and show titles. */
export const CHARADE_CATEGORIES: readonly Category[] = [
  {
    id: 'actions',
    name: 'Actions',
    cards: [
      'Brushing your teeth', 'Riding a bicycle', 'Painting a fence', 'Walking a dog', 'Climbing a ladder', 'Eating spaghetti', 'Playing the guitar', 'Washing a car',
      'Rowing a boat', 'Flipping pancakes', 'Taking a selfie', 'Sneezing loudly', 'Swimming underwater', 'Planting a tree', 'Catching a butterfly', 'Pushing a heavy door',
      'Juggling three balls', 'Baking a cake', 'Fishing at a lake', 'Walking in strong wind', 'Opening a stuck jar', 'Sweeping the floor', 'Skiing downhill', 'Milking a cow',
      'Typing a long email', 'Hammering a nail', 'Blowing up a balloon', 'Putting up a tent', 'Playing the drums', 'Chasing a bus',
    ].map((text, i) => ({ id: `actions:${i}`, text })),
  },
  titles('hollywood', 'Hollywood films', [
    ['Titanic', '1997 · English'], ['Jaws', '1975 · English'], ['Star Wars', '1977 · English'], ['E.T. the Extra-Terrestrial', '1982 · English'], ['Jurassic Park', '1993 · English'],
    ['The Lion King', '1994 · English'], ['Toy Story', '1995 · English'], ['Forrest Gump', '1994 · English'], ['The Matrix', '1999 · English'], ['Finding Nemo', '2003 · English'],
    ['Shrek', '2001 · English'], ['Frozen', '2013 · English'], ['Avatar', '2009 · English'], ['Inception', '2010 · English'], ['Gladiator', '2000 · English'],
    ['Back to the Future', '1985 · English'], ['Ghostbusters', '1984 · English'], ['Home Alone', '1990 · English'], ['The Godfather', '1972 · English'], ['Rocky', '1976 · English'],
    ['Casablanca', '1942 · English'], ['Up', '2009 · English'], ['Coco', '2017 · English'], ['Moana', '2016 · English'], ['Black Panther', '2018 · English'],
    ['Spider-Man', '2002 · English'], ['The Wizard of Oz', '1939 · English'], ['Mary Poppins', '1964 · English'], ['Kung Fu Panda', '2008 · English'], ['The Incredibles', '2004 · English'],
  ]),
  titles('bollywood', 'Bollywood films', [
    ['Sholay', '1975 · Hindi'], ['Dilwale Dulhania Le Jayenge', '1995 · Hindi'], ['Lagaan', '2001 · Hindi'], ['3 Idiots', '2009 · Hindi'], ['Dangal', '2016 · Hindi'],
    ['Zindagi Na Milegi Dobara', '2011 · Hindi'], ['Kuch Kuch Hota Hai', '1998 · Hindi'], ['Mughal-E-Azam', '1960 · Hindi'], ['Mother India', '1957 · Hindi'], ['Dil Chahta Hai', '2001 · Hindi'],
    ['Queen', '2013 · Hindi'], ['PK', '2014 · Hindi'], ['Bajrangi Bhaijaan', '2015 · Hindi'], ['Gully Boy', '2019 · Hindi'], ['Chak De! India', '2007 · Hindi'],
    ['Munna Bhai M.B.B.S.', '2003 · Hindi'], ['Taare Zameen Par', '2007 · Hindi'], ['Swades', '2004 · Hindi'], ['Devdas', '2002 · Hindi'], ['Barfi!', '2012 · Hindi'],
    ['Andhadhun', '2018 · Hindi'], ['Kabhi Khushi Kabhie Gham', '2001 · Hindi'], ['Hera Pheri', '2000 · Hindi'], ['Jab We Met', '2007 · Hindi'], ['Rang De Basanti', '2006 · Hindi'],
    ['Om Shanti Om', '2007 · Hindi'], ['Don', '1978 · Hindi'], ['Mr. India', '1987 · Hindi'], ['Border', '1997 · Hindi'], ['Rockstar', '2011 · Hindi'],
  ]),
  titles('shows', 'TV shows', [
    ['Friends', '1994 · English'], ['Sherlock', '2010 · English'], ['Game of Thrones', '2011 · English'], ['Breaking Bad', '2008 · English'], ['The Office', '2005 · English'],
    ['Stranger Things', '2016 · English'], ['Doctor Who', '1963 · English'], ['The Simpsons', '1989 · English'], ['Seinfeld', '1989 · English'], ['Money Heist', '2017 · Spanish'],
    ['Squid Game', '2021 · Korean'], ['Taarak Mehta Ka Ooltah Chashmah', '2008 · Hindi'], ['Sacred Games', '2018 · Hindi'], ['Mirzapur', '2018 · Hindi'], ['Panchayat', '2020 · Hindi'],
    ['The Crown', '2016 · English'], ['Chernobyl', '2019 · English'], ['The Mandalorian', '2019 · English'], ['Lost', '2004 · English'], ['Modern Family', '2009 · English'],
    ['Dark', '2017 · German'], ['Ted Lasso', '2020 · English'], ['Malgudi Days', '1986 · English'], ['Kaun Banega Crorepati', '2000 · Hindi'],
  ]),
]

export const categoriesById = (list: readonly Category[]): ReadonlyMap<string, Category> => new Map(list.map((c) => [c.id, c]))

/** The frozen draw pool for a selection: categories in bank order, cards in bank order. */
export function buildPool(list: readonly Category[], selected: readonly string[]): Card[] {
  return list.filter((c) => selected.includes(c.id)).flatMap((c) => c.cards)
}

/** Structural check used by the bank check script. Returns problems (empty = valid). */
export function validateBank(list: readonly Category[]): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const c of list) {
    if (!c.id || !c.name) problems.push(`category missing id or name: ${c.id}`)
    if (c.cards.length < 10) problems.push(`${c.id}: fewer than 10 cards`)
    const texts = new Set<string>()
    for (const card of c.cards) {
      if (ids.has(card.id)) problems.push(`duplicate id ${card.id}`)
      ids.add(card.id)
      if (!card.text.trim()) problems.push(`${card.id}: empty text`)
      if (card.text.length > 40) problems.push(`${card.id}: text too long`)
      if (texts.has(card.text.toLowerCase())) problems.push(`${c.id}: duplicate text "${card.text}"`)
      texts.add(card.text.toLowerCase())
    }
  }
  return problems
}
