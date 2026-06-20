import {
  OrderStatus,
  PaymentStatus,
  ReservationStatus,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../src/prisma/prisma.service';

// Order doesn't matter — FK checks are disabled during truncation.
const TABLES = [
  'AdminAuditLog', 'PaymentEvent', 'Payment', 'SslcommerzSession',
  'CouponRedemption', 'Shipment', 'OrderItem', 'Order', 'Coupon',
  'InventoryReservation', 'InventoryMovement', 'LowStockNotification',
  'CartItem', 'Cart', 'Review', 'WishlistItem', 'Wishlist',
  'ProductVariantAttributeValue', 'AttributeValue', 'ProductAttribute',
  'ProductImage', 'ProductVariant', 'ProductTranslation', 'CategoryProduct',
  'Product', 'Category', 'Redirect', 'Address', 'Customer', 'User',
  'NewsletterSubscriber', 'PageContent', 'SeoMeta', 'Setting', 'Job',
];

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
  for (const t of TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
}

export async function createAdmin(
  prisma: PrismaService,
  email = 'admin@test.local',
  password = 'Passw0rd!',
) {
  const passwordHash = await bcrypt.hash(password, 4); // low cost for test speed
  return prisma.user.create({
    data: { email, name: 'Test Admin', role: Role.ADMIN, passwordHash },
  });
}

export async function createCategory(
  prisma: PrismaService,
  slug = 'dresses',
  name = 'Dresses',
) {
  return prisma.category.create({ data: { name, slug, isActive: true } });
}

/** An active, published product with one in-stock variant. */
export async function createProduct(
  prisma: PrismaService,
  opts: {
    slug?: string;
    name?: string;
    sku?: string;
    stock?: number;
    categoryId?: string;
    isActive?: boolean;
    basePrice?: string;
    salePrice?: string;
    isFeatured?: boolean;
    featuredOrder?: number;
    variantPrice?: string;
    variantSalePrice?: string;
  } = {},
) {
  const slug = opts.slug ?? 'test-dress';
  return prisma.product.create({
    data: {
      name: opts.name ?? 'Test Dress',
      slug,
      sku: opts.sku ?? `SKU-${slug}`,
      shortDescription: 'A lovely test vintage dress',
      basePrice: opts.basePrice ?? '1000.00',
      salePrice: opts.salePrice ?? null,
      isActive: opts.isActive ?? true,
      isFeatured: opts.isFeatured ?? false,
      featuredOrder: opts.featuredOrder ?? 0,
      publishedAt: opts.isActive === false ? null : new Date(),
      categories: opts.categoryId
        ? { create: { categoryId: opts.categoryId } }
        : undefined,
      variants: {
        create: {
          sku: `${opts.sku ?? `SKU-${slug}`}-V1`,
          name: 'Default',
          stock: opts.stock ?? 2,
          price: opts.variantPrice ?? null,
          salePrice: opts.variantSalePrice ?? null,
        },
      },
    },
    include: { variants: true },
  });
}

/**
 * Creates an order in AWAITING_PAYMENT with a PENDING payment, an ACTIVE
 * reservation, and decremented stock — i.e. the exact state after checkout,
 * ready for the SSLCOMMERZ validation flow. Returns the identifiers a payment
 * test needs (tranId + amount string for crafting validation responses).
 */
export async function createPendingOrder(
  prisma: PrismaService,
  opts: { stock?: number; qty?: number; price?: string } = {},
): Promise<{ orderId: string; orderNumber: string; tranId: string; amount: string; variantId: string }> {
  const price = opts.price ?? '1000.00';
  const stock = opts.stock ?? 1;
  const qty = opts.qty ?? 1;
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  const amount = (Number(price) * qty).toFixed(2);

  const product = await prisma.product.create({
    data: {
      name: `Pay ${tag}`,
      slug: `pay-${tag}`,
      sku: `SKU-${tag}`,
      basePrice: price,
      isActive: true,
      publishedAt: new Date(),
      variants: { create: { sku: `V-${tag}`, name: 'Default', stock } },
    },
    include: { variants: true },
  });
  const variant = product.variants[0];
  const tranId = `TRAN-${tag}`;

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber: `ON-${tag}`,
        email: 'buyer@test.local',
        status: OrderStatus.AWAITING_PAYMENT,
        currency: 'BDT',
        subtotal: amount,
        grandTotal: amount,
        idempotencyKey: `idem-${tag}`,
        shipName: 'Buyer',
        shipPhone: '01700000000',
        shipLine1: '1 Test Road',
        shipCity: 'Dhaka',
        shipCountry: 'Bangladesh',
        items: {
          create: {
            variantId: variant.id,
            productName: product.name,
            variantName: variant.name,
            sku: variant.sku,
            unitPrice: price,
            quantity: qty,
            lineTotal: amount,
          },
        },
      },
    });
    await tx.productVariant.update({
      where: { id: variant.id },
      data: { stock: { decrement: qty } },
    });
    await tx.inventoryReservation.create({
      data: {
        variantId: variant.id,
        orderId: created.id,
        quantity: qty,
        status: ReservationStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    await tx.payment.create({
      data: {
        orderId: created.id,
        status: PaymentStatus.PENDING,
        amount,
        currency: 'BDT',
        tranId,
      },
    });
    return created;
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    tranId,
    amount,
    variantId: variant.id,
  };
}
