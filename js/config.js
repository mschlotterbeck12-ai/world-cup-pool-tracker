// Static configuration: my entry, tiers, scoring rules, team metadata, bracket template.
// Team names use FotMob spellings ("USA", "Turkiye", "DR Congo", "Bosnia and Herzegovina", "Curacao").

const WC = {};

// ---- My entry (tier -> team) ----
WC.MY_PICKS = [
  { tier: 1,  name: "France",      fotmobId: "6723" },
  { tier: 2,  name: "Brazil",      fotmobId: "8256" },
  { tier: 3,  name: "Germany",     fotmobId: "8570" },
  { tier: 4,  name: "USA",         fotmobId: "6713" },
  { tier: 5,  name: "Japan",       fotmobId: "6715" },
  { tier: 6,  name: "Austria",     fotmobId: "8255" },
  { tier: 7,  name: "Norway",      fotmobId: "8492" },
  { tier: 8,  name: "Ivory Coast", fotmobId: "6709" },
  { tier: 9,  name: "Czechia",     fotmobId: "8496" },
  { tier: 10, name: "Qatar",       fotmobId: "5902" },
  { tier: 11, name: "Saudi Arabia",fotmobId: "7795" },
  { tier: 12, name: "Ghana",       fotmobId: "6714" },
];

// ---- Real pool field (data/entries.js, baked from Dan's Google Sheet) ----
WC.MY_ENTRY_NAME = "Matthew Schlotterbeck";   // which sheet entry is mine
WC.MY_LABEL = "Matt";                          // display name for my entry
WC.ENTRY_LABELS = {                            // friendlier display names
  "Mike Schlotterbeck": "Dad (Mike)",
  "Sam Rutan - 1": "Evan and Sam",
};

// ---- Pool tiers (for generating rival entries) ----
WC.TIERS = {
  1:  ["France", "Spain", "Argentina", "England"],
  2:  ["Portugal", "Brazil", "Netherlands", "Morocco"],
  3:  ["Belgium", "Germany", "Croatia", "Colombia"],
  4:  ["Senegal", "Mexico", "USA", "Uruguay"],
  5:  ["Japan", "Switzerland", "Iran", "Turkiye"],
  6:  ["Ecuador", "Austria", "South Korea", "Australia"],
  7:  ["Algeria", "Egypt", "Canada", "Norway"],
  8:  ["Panama", "Ivory Coast", "Sweden", "Paraguay"],
  9:  ["Czechia", "Scotland", "Tunisia", "DR Congo"],
  10: ["Uzbekistan", "Qatar", "Iraq", "South Africa"],
  11: ["Saudi Arabia", "Jordan", "Bosnia and Herzegovina", "Cape Verde"],
  12: ["Ghana", "Curacao", "Haiti", "New Zealand"],
};
WC.DOUBLE_TIERS = new Set([9, 10, 11, 12]);
WC.TEAM_TIER = {};
for (const [tier, teams] of Object.entries(WC.TIERS)) {
  for (const t of teams) WC.TEAM_TIER[t] = +tier;
}

// ---- Scoring rules (defaults; editable in Settings) ----
WC.DEFAULT_SCORING = {
  goal: 1,                 // per goal, all rounds, no shootout goals
  groupWin: 3,
  groupDraw: 1,
  finish1st: 8,
  finish2nd: 4,
  finish3rdAdvance: 2,     // 3rd place AND advancing (8 of 12 thirds advance)
  reachR32: 0,             // 2026 has a Round of 32 the pool sheet didn't anticipate.
  reachR16: 4,             // Literal reading: bonuses start at the actual Round of 16.
  reachQF: 6,              // Confirm with Dan how he scores the R32 — edit these in
  reachSF: 8,              // Settings if he rules differently.
  reachFinal: 10,
  winFinal: 12,
  winBronze: 7,
};

// ---- Team metadata: FIFA rank (pool sheet), flag, group ----
WC.TEAMS = {
  "France":                 { rank: 1,  flag: "🇫🇷", group: "I" },
  "Spain":                  { rank: 2,  flag: "🇪🇸", group: "H" },
  "Argentina":              { rank: 3,  flag: "🇦🇷", group: "J" },
  "England":                { rank: 4,  flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", group: "L" },
  "Portugal":               { rank: 5,  flag: "🇵🇹", group: "K" },
  "Brazil":                 { rank: 6,  flag: "🇧🇷", group: "C" },
  "Netherlands":            { rank: 7,  flag: "🇳🇱", group: "F" },
  "Morocco":                { rank: 8,  flag: "🇲🇦", group: "C" },
  "Belgium":                { rank: 9,  flag: "🇧🇪", group: "G" },
  "Germany":                { rank: 10, flag: "🇩🇪", group: "E" },
  "Croatia":                { rank: 11, flag: "🇭🇷", group: "L" },
  "Colombia":               { rank: 13, flag: "🇨🇴", group: "K" },
  "Senegal":                { rank: 14, flag: "🇸🇳", group: "I" },
  "Mexico":                 { rank: 15, flag: "🇲🇽", group: "A" },
  "USA":                    { rank: 16, flag: "🇺🇸", group: "D" },
  "Uruguay":                { rank: 17, flag: "🇺🇾", group: "H" },
  "Japan":                  { rank: 18, flag: "🇯🇵", group: "F" },
  "Switzerland":            { rank: 19, flag: "🇨🇭", group: "B" },
  "Iran":                   { rank: 21, flag: "🇮🇷", group: "G" },
  "Turkiye":                { rank: 22, flag: "🇹🇷", group: "D" },
  "Ecuador":                { rank: 23, flag: "🇪🇨", group: "E" },
  "Austria":                { rank: 24, flag: "🇦🇹", group: "J" },
  "South Korea":            { rank: 25, flag: "🇰🇷", group: "A" },
  "Australia":              { rank: 27, flag: "🇦🇺", group: "D" },
  "Algeria":                { rank: 28, flag: "🇩🇿", group: "J" },
  "Egypt":                  { rank: 29, flag: "🇪🇬", group: "G" },
  "Canada":                 { rank: 30, flag: "🇨🇦", group: "B" },
  "Norway":                 { rank: 31, flag: "🇳🇴", group: "I" },
  "Panama":                 { rank: 33, flag: "🇵🇦", group: "L" },
  "Ivory Coast":            { rank: 34, flag: "🇨🇮", group: "E" },
  "Sweden":                 { rank: 38, flag: "🇸🇪", group: "F" },
  "Paraguay":               { rank: 40, flag: "🇵🇾", group: "D" },
  "Czechia":                { rank: 41, flag: "🇨🇿", group: "A" },
  "Scotland":               { rank: 43, flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", group: "C" },
  "Tunisia":                { rank: 44, flag: "🇹🇳", group: "F" },
  "DR Congo":               { rank: 46, flag: "🇨🇩", group: "K" },
  "Uzbekistan":             { rank: 50, flag: "🇺🇿", group: "K" },
  "Qatar":                  { rank: 55, flag: "🇶🇦", group: "B" },
  "Iraq":                   { rank: 57, flag: "🇮🇶", group: "I" },
  "South Africa":           { rank: 60, flag: "🇿🇦", group: "A" },
  "Saudi Arabia":           { rank: 61, flag: "🇸🇦", group: "H" },
  "Jordan":                 { rank: 63, flag: "🇯🇴", group: "J" },
  "Bosnia and Herzegovina": { rank: 65, flag: "🇧🇦", group: "B" },
  "Cape Verde":             { rank: 69, flag: "🇨🇻", group: "H" },
  "Ghana":                  { rank: 74, flag: "🇬🇭", group: "L" },
  "Curacao":                { rank: 82, flag: "🇨🇼", group: "E" },
  "Haiti":                  { rank: 83, flag: "🇭🇹", group: "C" },
  "New Zealand":            { rank: 85, flag: "🇳🇿", group: "L" },
};

// Common alternate spellings for the rival-entry editor.
WC.ALIASES = {
  "us": "USA", "united states": "USA", "usmnt": "USA", "america": "USA",
  "turkey": "Turkiye", "türkiye": "Turkiye",
  "korea": "South Korea", "korea republic": "South Korea",
  "bosnia": "Bosnia and Herzegovina", "bosnia-herzegovina": "Bosnia and Herzegovina",
  "congo dr": "DR Congo", "congo": "DR Congo", "drc": "DR Congo",
  "curaçao": "Curacao", "czech republic": "Czechia", "czech": "Czechia",
  "holland": "Netherlands", "ivory": "Ivory Coast", "cote d'ivoire": "Ivory Coast",
  "saudi": "Saudi Arabia", "new zealand": "New Zealand", "nz": "New Zealand",
  "south africa": "South Africa", "cape verde": "Cape Verde",
};

// ---- Knockout bracket template (FotMob match ids; fixed for the tournament) ----
// Round of 32: matchId -> [slotA, slotB]. "1A"=group A winner, "2B"=runner-up,
// "3:ABCDF"=a qualified 3rd from one of those groups.
WC.R32_TEMPLATE = {
  "4653705": ["2A", "2B"],
  "4653711": ["1C", "2F"],
  "4653703": ["1E", "3:ABCDF"],
  "4653706": ["1F", "2C"],
  "4653712": ["2E", "2I"],
  "4653704": ["1I", "3:CDFGH"],
  "4653713": ["1A", "3:CEFHI"],
  "4653714": ["1L", "3:EHIJK"],
  "4653710": ["1G", "3:AEHIJ"],
  "4653709": ["1D", "3:BEFIJ"],
  "4653708": ["1H", "2J"],
  "4653707": ["2K", "2L"],
  "4653717": ["1B", "3:EFGIJ"],
  "4653716": ["2D", "2G"],
  "4653715": ["1J", "2H"],
  "4653718": ["1K", "3:DEIJL"],
};
// Later rounds: matchId -> [feederMatchIdA, feederMatchIdB] (winners meet).
WC.KO_TEMPLATE = {
  // Round of 16
  "4653842": ["4653703", "4653704"],
  "4653843": ["4653705", "4653706"],
  "4653844": ["4653707", "4653708"],
  "4653845": ["4653709", "4653710"],
  "4653846": ["4653711", "4653712"],
  "4653847": ["4653713", "4653714"],
  "4653848": ["4653715", "4653716"],
  "4653849": ["4653717", "4653718"],
  // Quarter-finals
  "4653851": ["4653842", "4653843"],
  "4653852": ["4653844", "4653845"],
  "4653853": ["4653846", "4653847"],
  "4653854": ["4653848", "4653849"],
  // Semi-finals
  "4653855": ["4653851", "4653852"],
  "4653856": ["4653853", "4653854"],
  // Final
  "4653858": ["4653855", "4653856"],
};
WC.BRONZE_ID = "4653857";
WC.FINAL_ID = "4653858";
WC.ROUND_OF = { "1/16": "R32", "1/8": "R16", "1/4": "QF", "1/2": "SF", "bronze": "BRONZE", "final": "FINAL" };
WC.ROUND_LABEL = { R32: "Round of 32", R16: "Round of 16", QF: "Quarter-final", SF: "Semi-final", BRONZE: "3rd-place match", FINAL: "Final" };

// ---- Defaults for the simulation / pool field ----
WC.DEFAULT_SETTINGS = {
  nSims: 2000,
  fieldSize: 20,          // total entries in the pool including mine (guess; edit in Settings)
  hostBoost: 50,          // Elo boost for USA / Mexico / Canada
  countLiveGoals: true,
  scoring: WC.DEFAULT_SCORING,
  // Extra entries beyond the baked sheet, one per line: "Name: France, Brazil, ..."
  // (duplicates of sheet entries are ignored automatically)
  rivalsText: "",
};

WC.HOSTS = new Set(["USA", "Mexico", "Canada"]);

window.WC = WC;
