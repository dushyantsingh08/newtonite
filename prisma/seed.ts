import { PrismaClient, GlobalRole, TeamRole, WorkItemStatus, WorkItemPriority } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Clear existing data
  await prisma.itemEvent.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.workItem.deleteMany();
  await prisma.teamMembership.deleteMany();
  await prisma.team.deleteMany();
  await prisma.user.deleteMany();

  const password = await bcrypt.hash('password123', 10);

  // Users
  const admin = await prisma.user.create({
    data: { name: 'Admin', email: 'admin@example.com', password, globalRole: GlobalRole.ADMIN },
  });
  const pmPayments = await prisma.user.create({
    data: { name: 'Payments Manager', email: 'manager.payments@example.com', password },
  });
  const pmEngineering = await prisma.user.create({
    data: { name: 'Engineering Manager', email: 'manager.engineering@example.com', password },
  });
  const alice = await prisma.user.create({
    data: { name: 'Alice Member', email: 'alice@example.com', password },
  });
  const bob = await prisma.user.create({
    data: { name: 'Bob Member', email: 'bob@example.com', password },
  });
  const charlie = await prisma.user.create({
    data: { name: 'Charlie Viewer', email: 'charlie@example.com', password },
  });

  // Teams
  const paymentsTeam = await prisma.team.create({
    data: { name: 'Payments', description: 'Handles payment processing issues' },
  });
  const engineeringTeam = await prisma.team.create({
    data: { name: 'Engineering', description: 'Core platform engineering' },
  });
  const opsTeam = await prisma.team.create({
    data: { name: 'Operations', description: 'General operations' },
  });

  // Memberships
  await prisma.teamMembership.createMany({
    data: [
      { userId: pmPayments.id, teamId: paymentsTeam.id, role: TeamRole.LEAD },
      { userId: alice.id, teamId: paymentsTeam.id, role: TeamRole.MEMBER },
      { userId: bob.id, teamId: paymentsTeam.id, role: TeamRole.MEMBER },
      
      { userId: pmEngineering.id, teamId: engineeringTeam.id, role: TeamRole.LEAD },
      { userId: bob.id, teamId: engineeringTeam.id, role: TeamRole.MEMBER },
      
      { userId: charlie.id, teamId: paymentsTeam.id, role: TeamRole.VIEWER },
      { userId: charlie.id, teamId: engineeringTeam.id, role: TeamRole.VIEWER },
      { userId: charlie.id, teamId: opsTeam.id, role: TeamRole.VIEWER },
    ],
  });

  // Work Items
  const itemsData = [
    {
      title: 'Failed payment investigation',
      description: 'Customer transaction 12345 failed, investigate logs.',
      teamId: paymentsTeam.id,
      priority: WorkItemPriority.HIGH,
      status: WorkItemStatus.OPEN,
      requesterId: alice.id,
      assigneeId: bob.id,
    },
    {
      title: 'Weekly ops report',
      description: 'Compile and send the weekly ops report.',
      teamId: opsTeam.id,
      priority: WorkItemPriority.MEDIUM,
      status: WorkItemStatus.OPEN,
      requesterId: admin.id,
    },
    {
      title: 'Database migration',
      description: 'Run production migration for new schema.',
      teamId: engineeringTeam.id,
      priority: WorkItemPriority.CRITICAL,
      status: WorkItemStatus.BLOCKED,
      requesterId: pmEngineering.id,
      assigneeId: bob.id,
    },
    {
      title: 'Compliance approval for new vendor',
      description: 'Review and approve vendor X.',
      teamId: paymentsTeam.id,
      priority: WorkItemPriority.HIGH,
      status: WorkItemStatus.WAITING_APPROVAL,
      requesterId: alice.id,
      requiresApproval: true,
    },
  ];

  for (const data of itemsData) {
    await prisma.workItem.create({ data });
  }

  // Generate more dummy data for pagination/search
  const dummyItems = [];
  for (let i = 1; i <= 30; i++) {
    dummyItems.push({
      title: `Routine maintenance task ${i}`,
      description: `Perform routine maintenance for system part ${i}.`,
      teamId: engineeringTeam.id,
      priority: WorkItemPriority.LOW,
      status: i % 3 === 0 ? WorkItemStatus.RESOLVED : WorkItemStatus.OPEN,
      requesterId: pmEngineering.id,
    });
  }
  await prisma.workItem.createMany({ data: dummyItems });

  console.log('Database seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
