import { PrismaClient } from '../generated/prisma';

let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  // Ensure the prisma instance is re-used during hot-reloading
  // @ts-expect-error - global.prisma is not typed on global
  if (!global.prisma) {
    // @ts-expect-error - global.prisma is not typed on global
    global.prisma = new PrismaClient();
  }
  // @ts-expect-error - global.prisma is not typed on global
  prisma = global.prisma;
}

export default prisma; 