// Bundled original starter trivia (60 questions, 6 categories). Each question has one correct
// answer, three wrong options and a one-line explanation. All text is plain text and is only ever
// rendered as text nodes. Bump TRIVIA_VERSION when any question changes: saved matches freeze the
// shuffled question order against this version. Imported content (Phase 6) must carry licence
// and attribution data; none of this starter set is copied from a third-party deck.

export const TRIVIA_VERSION = 1

export interface Question {
  /** `${categoryId}:${n}`, stable. */
  id: string
  q: string
  /** Correct answer. In a match it is always option id 0; ids 1-3 are the wrong options. */
  a: string
  w: readonly [string, string, string]
  explanation: string
}

export interface TriviaCategory {
  id: string
  name: string
  questions: readonly Question[]
}

type Row = readonly [string, string, string, string, string, string]

function category(id: string, name: string, rows: readonly Row[]): TriviaCategory {
  return {
    id,
    name,
    questions: rows.map(([q, a, w1, w2, w3, explanation], i) => ({ id: `${id}:${i}`, q, a, w: [w1, w2, w3] as const, explanation })),
  }
}

export const TRIVIA_CATEGORIES: readonly TriviaCategory[] = [
  category('general', 'General knowledge', [
    ['How many days are in a leap year?', '366', '365', '364', '367', 'A leap year adds 29 February to the usual 365 days.'],
    ['Which planet is known as the Red Planet?', 'Mars', 'Venus', 'Jupiter', 'Mercury', 'Iron oxide dust on its surface gives Mars a red colour.'],
    ['How many sides does a hexagon have?', 'Six', 'Five', 'Seven', 'Eight', 'Hexa- means six.'],
    ['What is the largest ocean on Earth?', 'Pacific Ocean', 'Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean', 'The Pacific covers about a third of the planet.'],
    ['Which colour do you get by mixing blue and yellow paint?', 'Green', 'Purple', 'Orange', 'Brown', 'Blue and yellow paint together mostly reflect green light.'],
    ['How many strings does a standard violin have?', 'Four', 'Five', 'Six', 'Three', 'A violin is tuned in fifths to G, D, A and E.'],
    ['At what temperature in degrees Celsius does pure water freeze at sea level?', '0', '32', '100', '-10', 'The Celsius scale is defined with 0 as the freezing point of water.'],
    ['In which continent is Kenya?', 'Africa', 'Asia', 'South America', 'Europe', 'Kenya lies on the east coast of Africa.'],
    ['How many players does one football (soccer) team have on the pitch?', 'Eleven', 'Nine', 'Ten', 'Twelve', 'Each side fields eleven players including the goalkeeper.'],
    ['Which gas do plants take in from the air for photosynthesis?', 'Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen', 'Plants use carbon dioxide, water and light to make sugars.'],
  ]),
  category('science', 'Science', [
    ['What is the chemical symbol for gold?', 'Au', 'Ag', 'Gd', 'Go', 'Au comes from the Latin word aurum.'],
    ['Which force pulls objects towards the Earth?', 'Gravity', 'Magnetism', 'Friction', 'Tension', 'Gravity attracts all objects with mass.'],
    ['What is the common name for H2O?', 'Water', 'Hydrogen peroxide', 'Salt', 'Ammonia', 'Two hydrogen atoms and one oxygen atom make a water molecule.'],
    ['How many bones does an adult human body usually have?', '206', '186', '212', '256', 'Babies have more, but many bones fuse as we grow.'],
    ['Which organ pumps blood around the body?', 'Heart', 'Lungs', 'Liver', 'Kidney', 'The heart is a muscular pump.'],
    ['What is the hardest natural substance?', 'Diamond', 'Quartz', 'Topaz', 'Granite', 'Diamond is the hardest naturally occurring material.'],
    ['Which part of a plant absorbs water from the soil?', 'Roots', 'Leaves', 'Petals', 'Stem', 'Roots take up water and minerals.'],
    ['Roughly how fast does light travel in a vacuum?', '300,000 km per second', '30,000 km per second', '3,000 km per second', '3,000,000 km per second', 'The speed of light is about 299,792 km per second.'],
    ['What type of animal is a frog?', 'Amphibian', 'Reptile', 'Mammal', 'Fish', 'Frogs begin life in water and can live on land as adults.'],
    ['Which gas makes up most of the Earth’s atmosphere?', 'Nitrogen', 'Oxygen', 'Carbon dioxide', 'Argon', 'Nitrogen is about 78 percent of the air.'],
  ]),
  category('geography', 'Geography', [
    ['What is the capital of Japan?', 'Tokyo', 'Kyoto', 'Osaka', 'Seoul', 'Tokyo has been the capital since 1868.'],
    ['Which is the longest river in Africa?', 'The Nile', 'The Congo', 'The Niger', 'The Zambezi', 'The Nile flows north to the Mediterranean.'],
    ['Mount Everest is part of which mountain range?', 'The Himalayas', 'The Andes', 'The Alps', 'The Rockies', 'Everest lies on the border of Nepal and Tibet.'],
    ['What is the capital of Australia?', 'Canberra', 'Sydney', 'Melbourne', 'Perth', 'Canberra was purpose-built as the capital.'],
    ['Which country is the largest in the world by area?', 'Russia', 'Canada', 'China', 'The United States', 'Russia spans eleven time zones.'],
    ['On which continent is the Sahara Desert?', 'Africa', 'Asia', 'Australia', 'South America', 'The Sahara covers much of North Africa.'],
    ['What is the capital of Canada?', 'Ottawa', 'Toronto', 'Vancouver', 'Montreal', 'Ottawa sits on the border of Ontario and Quebec.'],
    ['Which ocean lies between Africa and Australia?', 'The Indian Ocean', 'The Atlantic Ocean', 'The Pacific Ocean', 'The Arctic Ocean', 'It borders Africa, Asia and Australia.'],
    ['Rio de Janeiro is a city in which country?', 'Brazil', 'Argentina', 'Portugal', 'Chile', 'Rio is famous for its beaches and carnival.'],
    ['What is the capital of India?', 'New Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'New Delhi is part of the wider Delhi region.'],
  ]),
  category('history', 'History', [
    ['Who was the first person to walk on the Moon?', 'Neil Armstrong', 'Buzz Aldrin', 'Yuri Gagarin', 'Michael Collins', 'Armstrong stepped onto the Moon on 20 July 1969.'],
    ['In which year did the Second World War end?', '1945', '1939', '1918', '1950', 'The war ended in 1945.'],
    ['Which ancient civilisation built the pyramids at Giza?', 'The ancient Egyptians', 'The Romans', 'The Greeks', 'The Mayans', 'The Giza pyramids were tombs for Egyptian pharaohs.'],
    ['Who was the first President of the United States?', 'George Washington', 'Abraham Lincoln', 'Thomas Jefferson', 'John Adams', 'Washington took office in 1789.'],
    ['Julius Caesar ruled which empire?', 'The Roman Empire', 'The Ottoman Empire', 'The Persian Empire', 'The Mongol Empire', 'Caesar led Rome in the first century BC.'],
    ['In which year did the Titanic sink?', '1912', '1905', '1920', '1898', 'It struck an iceberg in April 1912.'],
    ['Who is best known for leading India’s non-violent independence campaigns?', 'Mahatma Gandhi', 'Subhas Chandra Bose', 'Bhagat Singh', 'Lala Lajpat Rai', 'Gandhi promoted peaceful civil disobedience.'],
    ['In which year did India become independent?', '1947', '1950', '1942', '1935', 'India became independent on 15 August 1947.'],
    ['In which country is the Great Wall?', 'China', 'Japan', 'India', 'Mongolia', 'Parts of the wall are over 2,000 years old.'],
    ['Who painted the Mona Lisa?', 'Leonardo da Vinci', 'Michelangelo', 'Raphael', 'Pablo Picasso', 'Leonardo painted it in the early 1500s.'],
  ]),
  category('animals', 'Animals', [
    ['What is the largest land animal?', 'African elephant', 'Rhinoceros', 'Giraffe', 'Hippopotamus', 'African elephants can weigh several tonnes.'],
    ['How many legs does a spider have?', 'Eight', 'Six', 'Ten', 'Twelve', 'Spiders are arachnids, not insects.'],
    ['What do giant pandas mainly eat?', 'Bamboo', 'Fish', 'Berries', 'Grass', 'Bamboo makes up most of a panda’s diet.'],
    ['Which flightless bird is strongly associated with Antarctica?', 'Penguin', 'Ostrich', 'Emu', 'Kiwi', 'Emperor penguins breed on Antarctic ice.'],
    ['What is a baby kangaroo called?', 'A joey', 'A cub', 'A calf', 'A pup', 'Joeys grow in their mother’s pouch.'],
    ['Which animal is the fastest on land?', 'Cheetah', 'Lion', 'Horse', 'Greyhound', 'Cheetahs can reach about 100 km per hour in short bursts.'],
    ['What sweet food do bees make from nectar?', 'Honey', 'Jam', 'Caramel', 'Syrup', 'Bees turn nectar into honey and store it in the hive.'],
    ['Which mammal can truly fly?', 'Bat', 'Flying squirrel', 'Sugar glider', 'Flying fish', 'Bats are the only mammals capable of powered flight.'],
    ['How many hearts does an octopus have?', 'Three', 'One', 'Two', 'Four', 'Two pump blood through the gills and one through the body.'],
    ['What is a group of lions called?', 'A pride', 'A pack', 'A herd', 'A flock', 'A pride is a family group of lions.'],
  ]),
  category('space', 'Space', [
    ['Which planet is closest to the Sun?', 'Mercury', 'Venus', 'Earth', 'Mars', 'Mercury orbits the Sun in about 88 days.'],
    ['What is the name of our galaxy?', 'The Milky Way', 'Andromeda', 'The Whirlpool Galaxy', 'The Sombrero Galaxy', 'Our solar system sits inside the Milky Way.'],
    ['How many planets are in our solar system?', 'Eight', 'Seven', 'Nine', 'Ten', 'Pluto is classed as a dwarf planet.'],
    ['Which is the largest planet in our solar system?', 'Jupiter', 'Saturn', 'Neptune', 'Earth', 'Jupiter is more than twice as massive as all other planets combined.'],
    ['What is the Sun?', 'A star', 'A planet', 'A moon', 'A comet', 'The Sun is a medium-sized star.'],
    ['Which planet is most famous for its rings?', 'Saturn', 'Mars', 'Mercury', 'Venus', 'Saturn’s rings are made mostly of ice particles.'],
    ['What natural satellite orbits the Earth?', 'The Moon', 'Phobos', 'Titan', 'Europa', 'The Moon takes about 27 days to orbit once.'],
    ['Who was the first human in space?', 'Yuri Gagarin', 'Neil Armstrong', 'Alan Shepard', 'Buzz Aldrin', 'Gagarin orbited the Earth in 1961.'],
    ['What is a rock from space that reaches the Earth’s surface called?', 'A meteorite', 'An asteroid', 'A comet', 'A meteor', 'A meteor is the streak of light; a meteorite is what lands.'],
    ['About how long does the Earth take to orbit the Sun?', 'One year', 'One day', 'One month', 'Ten years', 'About 365 days.'],
  ]),
]

export const categoryQuestions = (selected: readonly string[]): Question[] =>
  TRIVIA_CATEGORIES.filter((c) => selected.includes(c.id)).flatMap((c) => c.questions)

const byId = new Map<string, Question>(TRIVIA_CATEGORIES.flatMap((c) => c.questions).map((q) => [q.id, q]))
export const questionById = (id: string): Question | undefined => byId.get(id)

/** Structural check used by the check script. Returns problems (empty = valid). */
export function validateTrivia(list: readonly TriviaCategory[]): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const c of list) {
    if (!c.id || !c.name) problems.push(`category missing id or name: ${c.id}`)
    if (c.questions.length < 10) problems.push(`${c.id}: fewer than 10 questions`)
    for (const q of c.questions) {
      if (ids.has(q.id)) problems.push(`duplicate id ${q.id}`)
      ids.add(q.id)
      const opts = [q.a, ...q.w]
      if (opts.some((o) => !o.trim())) problems.push(`${q.id}: empty option`)
      if (new Set(opts.map((o) => o.toLowerCase())).size !== 4) problems.push(`${q.id}: duplicate options`)
      if (!q.q.trim() || !q.explanation.trim()) problems.push(`${q.id}: missing text`)
      if ([q.q, q.explanation, ...opts].some((s) => /[<>]/.test(s))) problems.push(`${q.id}: markup characters in text`)
      if (q.q.length > 110 || opts.some((o) => o.length > 40)) problems.push(`${q.id}: text too long for the small screen`)
    }
  }
  return problems
}
