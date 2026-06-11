import mongoose from 'mongoose';
import { Game } from '../models/Game.js';
import { Platform } from '../models/Platform.js';
import { Room } from '../models/Room.js';
import { env } from '../config/env.js';

const gamesData = [
  {
    name: 'FIFA',
    slug: 'fifa',
    description: 'Le football virtuel par EA Sports',
    coverImage: '',
    isActive: true,
    developer: 'EA Sports',
    publisher: 'Electronic Arts',
    releaseYear: 1993
  },
  {
    name: 'Call of Duty',
    slug: 'call-of-duty',
    description: 'Le jeu de tir à la première personne le plus populaire',
    coverImage: '',
    isActive: true,
    developer: 'Infinity Ward',
    publisher: 'Activision',
    releaseYear: 2003
  },
  {
    name: 'Fortnite',
    slug: 'fortnite',
    description: 'Battle royale gratuit d\'Epic Games',
    coverImage: '',
    isActive: true,
    developer: 'Epic Games',
    publisher: 'Epic Games',
    releaseYear: 2017
  },
  {
    name: 'NBA 2K',
    slug: 'nba-2k',
    description: 'Simulation de basket-ball',
    coverImage: '',
    isActive: true,
    developer: 'Visual Concepts',
    publisher: '2K Sports',
    releaseYear: 1999
  },
  {
    name: 'eFootball',
    slug: 'efootball',
    description: 'Le successeur de PES par Konami',
    coverImage: '',
    isActive: true,
    developer: 'Konami',
    publisher: 'Konami',
    releaseYear: 2021
  },
  {
    name: 'Rocket League',
    slug: 'rocket-league',
    description: 'Football avec des voitures',
    coverImage: '',
    isActive: true,
    developer: 'Psyonix',
    publisher: 'Epic Games',
    releaseYear: 2015
  },
  {
    name: 'Mortal Kombat',
    slug: 'mortal-kombat',
    description: 'Jeu de combat légendaire',
    coverImage: '',
    isActive: true,
    developer: 'NetherRealm Studios',
    publisher: 'Warner Bros. Interactive Entertainment',
    releaseYear: 1992
  },
  {
    name: 'Street Fighter',
    slug: 'street-fighter',
    description: 'Le classique des jeux de combat',
    coverImage: '',
    isActive: true,
    developer: 'Capcom',
    publisher: 'Capcom',
    releaseYear: 1987
  }
];

const platformsData = [
  {
    name: 'PlayStation 5',
    slug: 'playstation-5',
    icon: '🎮',
    isActive: true,
    manufacturer: 'Sony'
  },
  {
    name: 'PlayStation 4',
    slug: 'playstation-4',
    icon: '🎮',
    isActive: true,
    manufacturer: 'Sony'
  },
  {
    name: 'Xbox Series X',
    slug: 'xbox-series-x',
    icon: '🎮',
    isActive: true,
    manufacturer: 'Microsoft'
  },
  {
    name: 'Xbox Series S',
    slug: 'xbox-series-s',
    icon: '🎮',
    isActive: true,
    manufacturer: 'Microsoft'
  },
  {
    name: 'Xbox One',
    slug: 'xbox-one',
    icon: '🎮',
    isActive: true,
    manufacturer: 'Microsoft'
  },
  {
    name: 'PC',
    slug: 'pc',
    icon: '💻',
    isActive: true,
    manufacturer: 'Various'
  },
  {
    name: 'Nintendo Switch',
    slug: 'nintendo-switch',
    icon: '🎮',
    isActive: true,
    manufacturer: 'Nintendo'
  }
];

async function seedGames() {
  console.log('🎮 Seeding Games...');
  for (const gameData of gamesData) {
    const existing = await Game.findOne({ slug: gameData.slug });
    if (!existing) {
      await Game.create(gameData);
      console.log(`  ✓ Created game: ${gameData.name}`);
    } else {
      console.log(`  - Game already exists: ${gameData.name}`);
    }
  }
  console.log('Games seeded successfully!\n');
}

async function seedPlatforms() {
  console.log('🎮 Seeding Platforms...');
  for (const platformData of platformsData) {
    const existing = await Platform.findOne({ slug: platformData.slug });
    if (!existing) {
      await Platform.create(platformData);
      console.log(`  ✓ Created platform: ${platformData.name}`);
    } else {
      console.log(`  - Platform already exists: ${platformData.name}`);
    }
  }
  console.log('Platforms seeded successfully!\n');
}

async function seedRooms() {
  console.log('🏠 Seeding Rooms...');
  
  const fifa = await Game.findOne({ slug: 'fifa' });
  const cod = await Game.findOne({ slug: 'call-of-duty' });
  const fortnite = await Game.findOne({ slug: 'fortnite' });
  
  const ps5 = await Platform.findOne({ slug: 'playstation-5' });
  const xbox = await Platform.findOne({ slug: 'xbox-series-x' });
  const pc = await Platform.findOne({ slug: 'pc' });

  if (!fifa || !cod || !fortnite || !ps5 || !xbox || !pc) {
    console.log('⚠️  Some games or platforms are missing. Skipping room seeding.');
    return;
  }

  const roomsData = [
    {
      name: 'FIFA PS5 - Débutant',
      game: fifa._id,
      platform: ps5._id,
      betAmount: 500,
      winMultiplier: 1.8,
      platformFee: 0.1,
      minRank: 'Bronze',
      maxRank: 'Silver',
      minLevel: 1,
      isActive: true,
      isFeatured: true,
      description: 'Salle pour les joueurs débutants sur FIFA PS5',
      rules: 'Match standard 6 minutes, pas de cheats, screenshot obligatoire'
    },
    {
      name: 'FIFA PS5 - Intermédiaire',
      game: fifa._id,
      platform: ps5._id,
      betAmount: 2000,
      winMultiplier: 1.8,
      platformFee: 0.1,
      minRank: 'Silver',
      maxRank: 'Gold',
      minLevel: 10,
      isActive: true,
      isFeatured: true,
      description: 'Salle pour les joueurs intermédiaires sur FIFA PS5',
      rules: 'Match standard 6 minutes, pas de cheats, screenshot obligatoire'
    },
    {
      name: 'FIFA PS5 - Pro',
      game: fifa._id,
      platform: ps5._id,
      betAmount: 10000,
      winMultiplier: 1.8,
      platformFee: 0.1,
      minRank: 'Gold',
      maxRank: 'Elite',
      minLevel: 20,
      isActive: true,
      isFeatured: true,
      description: 'Salle pour les joueurs pros sur FIFA PS5',
      rules: 'Match standard 6 minutes, pas de cheats, screenshot obligatoire'
    },
    {
      name: 'COD Xbox - 1v1',
      game: cod._id,
      platform: xbox._id,
      betAmount: 3000,
      winMultiplier: 1.8,
      platformFee: 0.1,
      minRank: '',
      maxRank: '',
      minLevel: 5,
      isActive: true,
      isFeatured: false,
      description: 'Match 1v1 Call of Duty sur Xbox',
      rules: 'Match à mort, pas de cheats, screenshot obligatoire'
    },
    {
      name: 'Fortnite PC - Build Fight',
      game: fortnite._id,
      platform: pc._id,
      betAmount: 1500,
      winMultiplier: 1.8,
      platformFee: 0.1,
      minRank: '',
      maxRank: '',
      minLevel: 1,
      isActive: true,
      isFeatured: false,
      description: 'Build Fight Fortnite sur PC',
      rules: 'Mode build fight, pas de cheats, screenshot obligatoire'
    },
    {
      name: 'FIFA Xbox - Elite',
      game: fifa._id,
      platform: xbox._id,
      betAmount: 25000,
      winMultiplier: 1.8,
      platformFee: 0.1,
      minRank: 'Elite',
      maxRank: 'Legend',
      minLevel: 30,
      isActive: true,
      isFeatured: true,
      description: 'Salle pour les joueurs élite sur FIFA Xbox',
      rules: 'Match standard 6 minutes, pas de cheats, screenshot obligatoire'
    }
  ];

  for (const roomData of roomsData) {
    const existing = await Room.findOne({ name: roomData.name });
    if (!existing) {
      await Room.create(roomData);
      console.log(`  ✓ Created room: ${roomData.name}`);
    } else {
      console.log(`  - Room already exists: ${roomData.name}`);
    }
  }
  console.log('Rooms seeded successfully!\n');
}

export async function seedGamesPlatformsRooms() {
  try {
    if (env.mongoUri === 'memory') {
      console.log('⚠️  Running with in-memory database. Skipping seed.');
      return;
    }

    await mongoose.connect(env.mongoUri);
    console.log('✅ Connected to MongoDB\n');

    await seedGames();
    await seedPlatforms();
    await seedRooms();

    console.log('🎉 All seeds completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedGamesPlatformsRooms();
}
