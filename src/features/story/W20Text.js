// Wave 20C: the Romanian of every player-facing line the wave 20 quest lines added (StoryW20.js chains, people, items, rumours,
// toasts; NoticeData.W20_NOTICES; the few words Story / Dialogue put round them). Whole English strings -> Romanian (comma-below
// ș ț); templates keep {who}. Lang.L reads it; test/feature-quests-w20.mjs checks every wave 20 string has its entry.
export const RO = {
	// the words round them
	'Quest': 'Misiune',
	'done': 'gata',
	'failed': 'eșuat',
	'Talk to': 'Vorbește cu',
	'work': 'de lucru',
	'About': 'Despre',
	'Any work?': 'Ai ceva de lucru?',
	'Not now.': 'Nu acum.',
	'the missing hand': 'marinarul dispărut',
	'signs on': 'se îmbarcă',
	'Choose what to say': 'Alege ce spui',
	'went off to the Rum Hole on Blackwater with the dice winners': 'a plecat la Rum Hole, pe Blackwater, cu câștigătorii de la zaruri',
	'signs on with you: post them from the crew list': 'se îmbarcă la tine: dă-i un post din lista echipajului',
	'The back-table lot take one look at you and leave': 'Gașca de la masa din spate se uită o dată la tine și pleacă',
	'A chair flies: the back table wants a fight · fists and cudgels, nobody dies': 'Zboară un scaun: masa din spate vrea bătaie · pumni și bâte, nu moare nimeni',
	'Thrown out on your ear. Walk back in when you are ready': 'Te-au dat afară de-a berbeleacul. Intră iar când ești gata',
	'is found asleep under a dice table and hauled back': 'e găsit dormind sub o masă de zaruri și adus înapoi',
	"Dov, Brine's pot boy": 'Dov, băiatul de la bar al lui Brine',
	'Convoy under attack': 'Convoi atacat',
	'Hyptile Harbour': 'Portul Hyptile',
	'Navy office': 'Biroul marinei',
	'The Rum Hole': 'Rum Hole',
	'The Tide & Tankard': 'Tide & Tankard',
	'Tidemark pier': 'Debarcaderul din Tidemark',
	'Pons Cove': 'Golful Pons',
	"The Merlin's wreck": 'Epava Merlinului',

	// Navy business (Lieutenant Hale)
	'Navy business': 'Treburile marinei',
	'Two cutters and a frigate for a whole sea. I need a captain who can hold a convoy together, sink a named raider and fly my dispatches to the home harbour. Do that and the fleet will know your name.':
		'Două cutere și o fregată pentru o mare întreagă. Am nevoie de un căpitan care să țină un convoi laolaltă, să scufunde un pirat cu nume și să-mi ducă depeșele cu avionul în portul de acasă. Fă asta și flota îți va ști numele.',
	'Convoy, raider, dispatches.': 'Convoi, pirat, depeșe.',
	'Convoys get jumped past the lanes. When you see one under attack, go in: raiders run from a hull that means it.':
		'Convoaiele sunt atacate dincolo de rute. Când vezi unul atacat, intră: pirații fug de o corabie hotărâtă.',
	"A convoy saved, a named raider sunk, my dispatches in Orla's hands. Then back here.": 'Un convoi salvat, un pirat cu nume scufundat, depeșele mele în mâinile Orlei. Apoi înapoi aici.',
	'Done, and done well.': 'Gata, și bine făcut.',
	'Garrow will face the court. It is the law, and you kept it. The fleet owes you; I have written it down.':
		'Garrow va sta în fața curții. E legea, și tu ai respectat-o. Flota îți e datoare; am trecut-o în scris.',
	'Slipped away, you say. In the night. I shall write that the sea took him. Do not make me write it twice.':
		'A scăpat, zici. Noaptea. Voi scrie că l-a luat marea. Nu mă pune să scriu asta de două ori.',
	'Navy business: a convoy saved, a named raider sunk, dispatches flown to Orla. You handed the deserter Garrow to the court-martial: the navy trusts you, the brotherhood less.':
		'Treburile marinei: un convoi salvat, un pirat cu nume scufundat, depeșe duse cu avionul la Orla. L-ai predat pe dezertorul Garrow curții marțiale: marina are încredere în tine, frăția mai puțin.',
	'Navy business: a convoy saved, a named raider sunk, dispatches flown to Orla. You let the deserter Garrow slip away; he signed on with you. The navy remembers, the brotherhood approves.':
		'Treburile marinei: un convoi salvat, un pirat cu nume scufundat, depeșe duse cu avionul la Orla. L-ai lăsat pe dezertorul Garrow să scape; s-a îmbarcat la tine. Marina ține minte, frăția aprobă.',
	'Save a merchant convoy under attack at sea (hit her raiders, or be close when they are beaten)':
		'Salvează un convoi negustoresc atacat pe mare (lovește-i atacatorii sau fii aproape când sunt învinși)',
	'Sink a named pirate captain (a roster captain, or a wanted notice)': 'Scufundă un căpitan pirat cu nume (unul din registru sau de pe un afiș de urmărire)',
	'Fly the dispatches to Hyptile Harbour: land a seaplane in the home bay': 'Du depeșele cu avionul în Portul Hyptile: amerizează cu hidroavionul în golful de acasă',
	'Hand the dispatches to Harbourmaster Orla': 'Predă depeșele căpităniei, Orlei',
	'Navy dispatches, by air? Hale is in a hurry. And one of his men jumped ship here: Tom Garrow. He is in my boathouse, begging not to go back. I will not decide it for you.':
		'Depeșe ale marinei, cu avionul? Hale se grăbește. Și unul dintre oamenii lui a dezertat aici: Tom Garrow. E în hangarul meu de bărci și se roagă să nu fie trimis înapoi. Nu hotărăsc eu în locul tău.',
	'Dispatches, from Lieutenant Hale.': 'Depeșe, de la locotenentul Hale.',
	"Decide Tom Garrow's fate with Lieutenant Hale": 'Hotărăște soarta lui Tom Garrow cu locotenentul Hale',
	"Orla's seal. Good. And Garrow? Somebody saw him on your island. Tell me straight, captain.": 'Sigiliul Orlei. Bine. Și Garrow? Cineva l-a văzut pe insula ta. Spune-mi drept, căpitane.',
	"He is in Orla's boathouse. Send your men.": 'E în hangarul de bărci al Orlei. Trimite-ți oamenii.',
	'Then he will have a fair court. More than he gave his shipmates.': 'Atunci va avea o judecată dreaptă. Mai mult decât le-a dat camarazilor lui.',
	'Never saw him. He must have slipped away.': 'Nu l-am văzut. Probabil a scăpat.',
	'Must he. Very well. The navy will remember this answer, captain.': 'Probabil, zici. Foarte bine. Marina va ține minte răspunsul ăsta, căpitane.',

	// Convoy duty
	'Convoy duty': 'Serviciu de convoi',
	'Another convoy is due through the lanes. Bring her through, then collect what the Crown owes you at the office.':
		'Alt convoi trebuie să treacă pe rute. Adu-l cu bine, apoi ia de la birou ce-ți datorează Coroana.',
	'Another convoy.': 'Încă un convoi.',
	'Same as before. Stay close, shoot straight.': 'Ca data trecută. Stai aproape, trage drept.',
	'The convoy will not wait on you.': 'Convoiul nu te așteaptă.',
	"She is in. The guild sends its thanks; I send the Crown's.": 'A ajuns. Breasla îți mulțumește; eu îți mulțumesc din partea Coroanei.',
	'Convoy duty: another convoy brought through for Lieutenant Hale.': 'Serviciu de convoi: încă un convoi adus cu bine pentru locotenentul Hale.',
	"Claim your navy bounties at Tidemark (the navy office or the harbourmaster's board)": 'Încasează recompensele marinei la Tidemark (biroul marinei sau avizierul căpităniei)',

	// Dice night (Brine)
	'Dice night': 'Noaptea zarurilor',
	'Bad night. Dice till dawn, a fight at the back table, and somebody went off to Blackwater with the winners. One of yours, I think. Find them, help me throw the back-table lot out, and there is a little job for the next stormy night.':
		'Noapte proastă. Zaruri până în zori, bătaie la masa din spate și cineva a plecat la Blackwater cu câștigătorii. Unul de-al tău, cred. Găsește-l, ajută-mă să dau afară gașca de la masa din spate și am o mică treabă pentru următoarea noapte cu furtună.',
	'I will find them.': 'Îl găsesc eu.',
	'The winners drink it at the Rum Hole on Blackwater. Look under the tables.': 'Câștigătorii beau totul la Rum Hole, pe Blackwater. Uită-te sub mese.',
	'Found them yet? Then the back table, then the casks.': 'L-ai găsit? Apoi masa din spate, apoi butoaiele.',
	'Found, fought and run past the cutters. You drink here on the house now. Not too much.': 'Găsit, bătut și strecurat pe lângă cutere. De-acum bei aici din partea casei. Nu prea mult.',
	"Dice night: your hand fetched from the Rum Hole, the back-table brawl won, Brine's casks run to Pons past the cutters. A quarter off at the Tide & Tankard, and the bar tabs are on the house.":
		'Noaptea zarurilor: marinarul tău adus de la Rum Hole, bătaia de la masa din spate câștigată, butoaiele lui Brine duse la Pons pe lângă cutere. Un sfert reducere la Tide & Tankard, iar consumația echipajului e din partea casei.',
	"The cutter's men poured Brine's casks over the side: he will load more on the next stormy night": 'Oamenii de pe cuter au vărsat butoaiele lui Brine peste bord: va încărca altele în următoarea noapte cu furtună',
	'Find {who} at the Rum Hole on Blackwater (walk in, or ask at the black market)': 'Găsește-l pe {who} la Rum Hole, pe Blackwater (intră sau întreabă la piața neagră)',
	'Settle the back-table brawl in the Tide & Tankard: walk in and win the fight': 'Potolește bătaia de la masa din spate din Tide & Tankard: intră și câștigă lupta',
	"Put to sea from Tidemark with Brine's casks on a stormy night (rain or a squall, after dark)": 'Ieși pe mare din Tidemark cu butoaiele lui Brine într-o noapte cu furtună (ploaie sau vijelie, după lăsarea întunericului)',
	'Land the casks at Pons Cove without being boarded by the navy': 'Descarcă butoaiele în Golful Pons fără să fii abordat de marină',
	'Tell Brine the casks are in': 'Spune-i lui Brine că butoaiele au ajuns',
	'Well? Did the cutters see you?': 'Ei? Te-au văzut cuterele?',
	'Not a lantern on us.': 'Niciun felinar pe noi.',

	// Another stormy night
	'Another stormy night': 'Încă o noapte cu furtună',
	'More casks, same arrangement. Wait for weather, go dark, land them at Pons.': 'Alte butoaie, aceeași înțelegere. Așteaptă vremea rea, stinge luminile, descarcă-le la Pons.',
	'Same arrangement.': 'Aceeași înțelegere.',
	'Lanterns out past the pier head.': 'Felinarele stinse după capătul debarcaderului.',
	'The casks are still in my cellar.': 'Butoaiele sunt încă în pivnița mea.',
	'Pons has its casks; you have your cut.': 'Pons are butoaiele; tu ai partea ta.',

	// Wren's past
	"Wren's past": 'Trecutul lui Wren',
	'I steered the cutter Merlin, best helm in the fleet. Then a storm put her on the rocks off Gull Rock, and I have been green at sea ever since. Sign me on. Take me back out there, through one storm. Either I come back a sailor, or I stay ashore for good.':
		'Am fost cârmaci pe cuterul Merlin, cea mai bună cârmă din flotă. Apoi o furtună l-a aruncat pe stâncile de lângă Gull Rock și de atunci mi se face rău pe mare. Ia-mă în echipaj. Du-mă înapoi acolo, printr-o furtună. Ori mă întorc marinar, ori rămân pe uscat pentru totdeauna.',
	'Sign on. We go together.': 'Îmbarcă-te. Mergem împreună.',
	'My sea bag is packed. It has been packed for two years.': 'Sacul meu de marinar e făcut. E făcut de doi ani.',
	'Gull Rock, then weather. I will not ask twice.': 'Gull Rock, apoi vremea rea. Nu te rog de două ori.',
	'I did not heave once. Not once. Give me the helm in the next blow, captain.': 'Nu mi-a fost rău nici măcar o dată. Nici o dată. Dă-mi cârma la următoarea vijelie, căpitane.',
	"Wren's past: back to the Merlin's wreck and through a storm. Wren is no longer seasick (her sailing can grow to 100, not 60) and she is brave now.":
		'Trecutul lui Wren: înapoi la epava Merlinului și printr-o furtună. Lui Wren nu-i mai e rău pe mare (navigația ei poate crește până la 100, nu doar 60) și acum e curajoasă.',
	'Wren signed off and went ashore for good': 'Wren a plecat din echipaj și a rămas pe uscat pentru totdeauna',
	'Sign Wren on (a free berth on your crew list: six hands at most)': 'Ia-o pe Wren în echipaj (un loc liber în lista echipajului: cel mult șase marinari)',
	'Sail Wren to where the Merlin went down, south of Gull Rock': 'Du-o pe Wren unde s-a scufundat Merlinul, la sud de Gull Rock',
	'Ride out a storm at sea with Wren aboard (half a minute in the weather)': 'Înfruntă o furtună pe mare cu Wren la bord (o jumătate de minut în vremea rea)',
	'Bring Wren back into port': 'Adu-o pe Wren înapoi în port',

	// Chasing the line (Old Pepe)
	'Chasing the line': 'Pe urmele frontului',
	'Forty years I read the sky from this bench. Now the fronts come in lines, black as tar, lightning walking under them. Somebody young should go and look. Meet one at sea, ride its squall, and get close to its lightning in that flying machine of yours. Or find me a waterspout. Then come and tell me.':
		'Patruzeci de ani am citit cerul de pe banca asta. Acum fronturile vin în linii, negre ca smoala, cu fulgere mergând pe sub ele. Cineva tânăr ar trebui să meargă să vadă. Întâlnește unul pe mare, înfruntă-i vijelia și apropie-te de fulgerele lui cu mașinăria ta zburătoare. Sau găsește-mi o trombă marină. Apoi vino și povestește-mi.',
	'I will chase it.': 'Mă iau după el.',
	"The harbourmaster and the plane's radio read the forecast. Go when the sky turns the colour of a bruise.": 'Căpitănia și radioul avionului citesc prognoza. Pleacă atunci când cerul se face de culoarea unei vânătăi.',
	'Not yet? The next line is coming. My knees say so.': 'Încă nu? Vine următorul front. Mi-o spun genunchii.',
	'That close, and you came back to tell it. Take my storm glass: when the crystals cloud, a front is coming.': 'Atât de aproape, și te-ai întors să povestești. Ia-mi barometrul cu cristale: când se tulbură cristalele, vine un front.',
	'Chasing the line: a storm front met at sea, its squall ridden, its lightning seen from the air. Old Pepe gave you his storm glass.':
		'Pe urmele frontului: un front de furtună întâlnit pe mare, vijelia lui înfruntată, fulgerele lui văzute din aer. Bătrânul Pepe ți-a dat barometrul lui cu cristale.',
	'Be at sea, aboard or flying, when a storm front reaches you': 'Fii pe mare, la bord sau în zbor, când te ajunge un front de furtună',
	"Ride the squall at the front's edge for half a minute, at sea": 'Înfruntă vijelia de la marginea frontului o jumătate de minut, pe mare',
	'Fly within 400 m of a lightning strike, or see a waterspout from within 500 m': 'Zboară la mai puțin de 400 m de un trăsnet sau vezi o trombă marină de la mai puțin de 500 m',
	'Tell Old Pepe what you saw': 'Spune-i Bătrânului Pepe ce ai văzut',
	'Well? Did the sky do what I said?': 'Ei? A făcut cerul ce am zis?',
	'Lightning close enough to smell.': 'Fulgere atât de aproape că le simțeam mirosul.',

	// Another line
	'Another line': 'Încă un front',
	'There is another line coming. Go up and look at it for me. My knees cannot.': 'Vine încă un front. Urcă și uită-te la el pentru mine. Genunchii mei nu mai pot.',
	'Up I go.': 'Urc.',
	'Close, but not too close.': 'Aproape, dar nu prea aproape.',
	'The line is still out there.': 'Frontul e încă acolo.',
	'Ha! Close enough to smell. Good.': 'Ha! Destul de aproape să-i simți mirosul. Bine.',

	// people and things
	'Lieutenant Hale': 'Locotenentul Hale',
	'Navy lieutenant, the naval jetty': 'Locotenent de marină, cheiul marinei',
	'Wren Calloway': 'Wren Calloway',
	'Sailor for hire, the Tide & Tankard': 'Marinar de închiriat, Tide & Tankard',
	"Hale's commendation": 'Recomandarea lui Hale',
	"A lieutenant's letter: the naval jetty's chandler knocks a tenth off for you.": 'Scrisoarea unui locotenent: magazinul de pe cheiul marinei îți lasă o zecime din preț.',
	"Garrow's clasp knife": 'Briceagul lui Garrow',
	"A deserter's thanks. The brotherhood knows the knife.": 'Mulțumirea unui dezertor. Frăția cunoaște briceagul.',
	'A tab at the Tide & Tankard': 'Cont deschis la Tide & Tankard',
	"Brine's thanks: a quarter off at his bar, and your hands' bar tabs are on the house.": 'Mulțumirea lui Brine: un sfert reducere la barul lui, iar consumația marinarilor tăi e din partea casei.',
	"Old Pepe's storm glass": 'Barometrul cu cristale al Bătrânului Pepe',
	'When the crystals cloud, a front is coming. The weather bothers you a little less.': 'Când se tulbură cristalele, vine un front. Vremea rea te supără ceva mai puțin.',

	// tavern rumours
	'The navy lieutenant at the naval jetty is short of captains. Convoys keep getting jumped past the lanes.': 'Locotenentului de pe cheiul marinei îi lipsesc căpitani. Convoaiele tot sunt atacate dincolo de rute.',
	'Brine had a rough dice night at the Tide & Tankard. Somebody went off to Blackwater with the winnings.': 'Brine a avut o noapte grea la zaruri la Tide & Tankard. Cineva a plecat la Blackwater cu câștigul.',
	'The woman on the Tide & Tankard porch steered navy cutters once, they say. Will not set foot on a deck now.': 'Femeia de pe prispa de la Tide & Tankard a fost cârmaci pe cuterele marinei, se zice. Acum nu mai pune piciorul pe punte.',
	'Old Pepe has been staring at the sky all week. Says the storm lines come in black, with lightning under them.': 'Bătrânul Pepe se uită la cer toată săptămâna. Zice că fronturile de furtună vin negre, cu fulgere pe sub ele.',

	// the notice boards
	'Lieutenant Hale, the naval jetty': 'Locotenentul Hale, cheiul marinei',
	'Captains wanted for convoy work, a raider hunt and dispatches by air. Report to the naval jetty at Tidemark.': 'Căutăm căpitani pentru convoaie, o vânătoare de pirați și depeșe cu avionul. Prezentați-vă pe cheiul marinei din Tidemark.',
	'Brine, the Tide & Tankard': 'Brine, Tide & Tankard',
	'Lost: one sailor, last seen leaving with the dice winners. Also wanted: a steady pair of fists, and a captain who does not mind weather.':
		'Pierdut: un marinar, văzut ultima oară plecând cu câștigătorii de la zaruri. Căutăm și o pereche de pumni zdraveni și un căpitan căruia nu-i pasă de vreme.',
	'Wren Calloway, on the porch': 'Wren Calloway, pe prispă',
	'Former navy helm seeks a berth and one storm. Ask on the Tide & Tankard porch.': 'Fost cârmaci de marină caută un loc pe o navă și o furtună. Întrebați pe prispa de la Tide & Tankard.',
	'Old Pepe, weather prophet': 'Bătrânul Pepe, profetul vremii',
	'Somebody young, with a boat and a plane, to go and look at the storm lines up close. Ask on the bench by the plaza.': 'Cineva tânăr, cu barcă și avion, care să vadă de aproape fronturile de furtună. Întrebați pe banca de lângă piață.',
	"Another convoy is due through the lanes. Bring her through and collect the Crown's bounty.": 'Alt convoi trebuie să treacă pe rute. Adu-l cu bine și încasează recompensa Coroanei.',
	'Casks for Pons, same arrangement as before. Wait for weather.': 'Butoaie pentru Pons, aceeași înțelegere ca înainte. Așteaptă vremea rea.',
	'Another storm line is coming. Fly up and look at its lightning for an old man.': 'Vine încă un front de furtună. Zboară și uită-te la fulgerele lui pentru un bătrân.',
};
