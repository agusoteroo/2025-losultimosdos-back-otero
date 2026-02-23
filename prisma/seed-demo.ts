import { Level, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_ADMIN_ID = "seed-admin-user";

type ExerciseSeed = {
  name: string;
  equipment?: string;
  muscleGroup: string;
};

type RoutineSeed = {
  name: string;
  description: string;
  level: Level;
  duration: number;
  sedeName: string;
  exercises: Array<{
    exerciseName: string;
    sets?: number;
    reps?: number;
    restTime?: number;
  }>;
};

type ClassSeed = {
  name: string;
  description: string;
  dayOffset: number;
  time: string;
  capacity: number;
  sedeName: string;
  isBoostedForPoints?: boolean;
};

const sedesSeed = [
  {
    name: "Recoleta",
    address: "Av. Pueyrredon 2068",
    latitude: -34.5889,
    longitude: -58.3974,
  },
  {
    name: "Palermo",
    address: "Av. Santa Fe 4100",
    latitude: -34.5883,
    longitude: -58.4226,
  },
];

const muscleGroupsSeed = [
  "Pecho",
  "Espalda",
  "Piernas",
  "Hombros",
  "Core",
  "Cardio",
];

const exercisesSeed: ExerciseSeed[] = [
  { name: "Press de banca", equipment: "Barra", muscleGroup: "Pecho" },
  { name: "Flexiones", equipment: "Peso corporal", muscleGroup: "Pecho" },
  { name: "Remo con barra", equipment: "Barra", muscleGroup: "Espalda" },
  { name: "Dominadas asistidas", equipment: "Maquina", muscleGroup: "Espalda" },
  { name: "Sentadilla goblet", equipment: "Mancuerna", muscleGroup: "Piernas" },
  { name: "Prensa de piernas", equipment: "Maquina", muscleGroup: "Piernas" },
  { name: "Press militar", equipment: "Mancuernas", muscleGroup: "Hombros" },
  { name: "Elevaciones laterales", equipment: "Mancuernas", muscleGroup: "Hombros" },
  { name: "Plancha", equipment: "Peso corporal", muscleGroup: "Core" },
  { name: "Crunch", equipment: "Peso corporal", muscleGroup: "Core" },
  { name: "Cinta de correr", equipment: "Cinta", muscleGroup: "Cardio" },
  { name: "Bicicleta estatica", equipment: "Bicicleta", muscleGroup: "Cardio" },
];

const routinesSeed: RoutineSeed[] = [
  {
    name: "Full Body Inicial",
    description: "Rutina general para empezar con tecnica y volumen moderado",
    level: Level.Beginner,
    duration: 45,
    sedeName: "Recoleta",
    exercises: [
      { exerciseName: "Sentadilla goblet", sets: 3, reps: 12, restTime: 60 },
      { exerciseName: "Press de banca", sets: 3, reps: 10, restTime: 90 },
      { exerciseName: "Remo con barra", sets: 3, reps: 10, restTime: 90 },
      { exerciseName: "Plancha", sets: 3, reps: 1, restTime: 45 },
    ],
  },
  {
    name: "Torso Intermedio",
    description: "Enfoque en empuje y traccion para tren superior",
    level: Level.Intermediate,
    duration: 55,
    sedeName: "Palermo",
    exercises: [
      { exerciseName: "Press de banca", sets: 4, reps: 8, restTime: 90 },
      { exerciseName: "Dominadas asistidas", sets: 4, reps: 8, restTime: 90 },
      { exerciseName: "Press militar", sets: 3, reps: 10, restTime: 75 },
      { exerciseName: "Elevaciones laterales", sets: 3, reps: 15, restTime: 45 },
    ],
  },
  {
    name: "Cardio + Core",
    description: "Sesion corta para resistencia y abdomen",
    level: Level.Beginner,
    duration: 30,
    sedeName: "Recoleta",
    exercises: [
      { exerciseName: "Cinta de correr", sets: 1, reps: 1, restTime: 0 },
      { exerciseName: "Bicicleta estatica", sets: 1, reps: 1, restTime: 0 },
      { exerciseName: "Crunch", sets: 3, reps: 20, restTime: 30 },
      { exerciseName: "Plancha", sets: 3, reps: 1, restTime: 30 },
    ],
  },
];

const classesSeed: ClassSeed[] = [
  {
    name: "Funcional AM",
    description: "Clase funcional de cuerpo completo",
    dayOffset: -7,
    time: "09:00",
    capacity: 16,
    sedeName: "Recoleta",
  },
  {
    name: "Spinning",
    description: "Clase de bici indoor",
    dayOffset: -1,
    time: "18:30",
    capacity: 20,
    sedeName: "Palermo",
  },
  {
    name: "Yoga Flow",
    description: "Movilidad y respiracion",
    dayOffset: 1,
    time: "10:00",
    capacity: 18,
    sedeName: "Recoleta",
    isBoostedForPoints: true,
  },
  {
    name: "HIIT Express",
    description: "Intervalos de alta intensidad",
    dayOffset: 2,
    time: "19:00",
    capacity: 14,
    sedeName: "Palermo",
  },
  {
    name: "Movilidad",
    description: "Clase suave de movilidad articular",
    dayOffset: 5,
    time: "08:30",
    capacity: 12,
    sedeName: "Recoleta",
  },
];

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function upsertSedes() {
  const sedesByName = new Map<string, Awaited<ReturnType<typeof prisma.sede.upsert>>>();

  for (const sede of sedesSeed) {
    const row = await prisma.sede.upsert({
      where: { id: sedesSeed.findIndex((s) => s.name === sede.name) + 1 },
      update: {
        name: sede.name,
        address: sede.address,
        latitude: sede.latitude,
        longitude: sede.longitude,
      },
      create: sede,
    });
    sedesByName.set(row.name, row);
  }

  return sedesByName;
}

async function upsertMuscleGroups() {
  const byName = new Map<string, Awaited<ReturnType<typeof prisma.muscleGroup.upsert>>>();

  for (const name of muscleGroupsSeed) {
    const row = await prisma.muscleGroup.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    byName.set(name, row);
  }

  return byName;
}

async function upsertExercises(muscleGroupsByName: Map<string, { id: number }>) {
  const byName = new Map<string, Awaited<ReturnType<typeof prisma.exercise.create>>>();

  for (const ex of exercisesSeed) {
    const muscleGroup = muscleGroupsByName.get(ex.muscleGroup);
    if (!muscleGroup) {
      throw new Error(`Muscle group not found in seed map: ${ex.muscleGroup}`);
    }

    const existing = await prisma.exercise.findFirst({
      where: { name: ex.name, muscleGroupId: muscleGroup.id },
    });

    const row = existing
      ? await prisma.exercise.update({
          where: { id: existing.id },
          data: {
            name: ex.name,
            equipment: ex.equipment ?? null,
          },
        })
      : await prisma.exercise.create({
          data: {
            name: ex.name,
            equipment: ex.equipment ?? null,
            muscleGroupId: muscleGroup.id,
          },
        });

    byName.set(ex.name, row);
  }

  return byName;
}

async function upsertRoutines(
  sedesByName: Map<string, { id: number }>,
  exercisesByName: Map<string, { id: number }>
) {
  for (const routine of routinesSeed) {
    const sede = sedesByName.get(routine.sedeName);
    if (!sede) throw new Error(`Sede not found for routine: ${routine.sedeName}`);

    const existing = await prisma.routine.findFirst({
      where: { name: routine.name, sedeId: sede.id },
      select: { id: true },
    });

    const saved = existing
      ? await prisma.routine.update({
          where: { id: existing.id },
          data: {
            name: routine.name,
            description: routine.description,
            level: routine.level,
            duration: routine.duration,
            sedeId: sede.id,
          },
        })
      : await prisma.routine.create({
          data: {
            name: routine.name,
            description: routine.description,
            level: routine.level,
            duration: routine.duration,
            sedeId: sede.id,
          },
        });

    await prisma.routineExercise.deleteMany({ where: { routineId: saved.id } });

    for (const item of routine.exercises) {
      const exercise = exercisesByName.get(item.exerciseName);
      if (!exercise) throw new Error(`Exercise not found for routine: ${item.exerciseName}`);

      await prisma.routineExercise.create({
        data: {
          routineId: saved.id,
          exerciseId: exercise.id,
          sets: item.sets ?? null,
          reps: item.reps ?? null,
          restTime: item.restTime ?? null,
        },
      });
    }
  }
}

async function upsertClasses(sedesByName: Map<string, { id: number }>) {
  const today = new Date();

  for (const cls of classesSeed) {
    const sede = sedesByName.get(cls.sedeName);
    if (!sede) throw new Error(`Sede not found for class: ${cls.sedeName}`);

    const classDate = startOfDay(addDays(today, cls.dayOffset));

    const existing = await prisma.class.findFirst({
      where: {
        name: cls.name,
        sedeId: sede.id,
        date: classDate,
        time: cls.time,
      },
      select: { id: true },
    });

    const data = {
      name: cls.name,
      description: cls.description,
      date: classDate,
      time: cls.time,
      capacity: cls.capacity,
      sedeId: sede.id,
      createdById: SEED_ADMIN_ID,
      isBoostedForPoints: cls.isBoostedForPoints ?? false,
    };

    if (existing) {
      await prisma.class.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.class.create({ data });
    }
  }
}

async function main() {
  console.log("Seeding demo data...");

  const sedesByName = await upsertSedes();
  const muscleGroupsByName = await upsertMuscleGroups();
  const exercisesByName = await upsertExercises(muscleGroupsByName);
  await upsertRoutines(sedesByName, exercisesByName);
  await upsertClasses(sedesByName);

  console.log("Seed demo completed.");
}

main()
  .catch((error) => {
    console.error("Seed demo failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
