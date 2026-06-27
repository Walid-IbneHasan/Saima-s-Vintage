import {
  ContentStatus,
  OrderStatus,
  PaymentStatus,
  PrismaClient,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Local Lippan/Jharoka product imagery, served from /public (CSP allows 'self').
const P = (file: string): string => `/images/products/${file}`;

const rnd = (n: number) => Math.floor(Math.random() * n);

// Demo tables to wipe before reseeding (User is preserved/ upserted separately).
const DEMO_TABLES = [
  'AdminAuditLog', 'PaymentEvent', 'Payment',
  'CouponRedemption', 'Shipment', 'OrderItem', 'Order', 'Coupon',
  'InventoryReservation', 'InventoryMovement', 'LowStockNotification',
  'CartItem', 'Cart', 'Review', 'WishlistItem', 'Wishlist',
  'ProductVariantAttributeValue', 'AttributeValue', 'ProductAttribute',
  'ProductImage', 'ProductVariant', 'ProductTranslation', 'CategoryProduct',
  'Product', 'Category', 'Redirect', 'Address', 'Customer',
  'PageContent', 'SeoMeta', 'Job',
];

const CATEGORY_TREE = [
  {
    slug: 'lippan-art', name: 'Lippan Art',
    desc: 'Mirror-inlay clay mandalas, plates and flowers — traditional Kutchi Lippan craft.',
    image: P('lippan-mandala-marigold.avif'),
    subs: [
      { slug: 'mandalas', name: 'Mandalas' },
      { slug: 'mirror-plates', name: 'Mirror Plates' },
    ],
  },
  {
    slug: 'jharokas', name: 'Jharokas',
    desc: 'Hand-painted and carved arched Jharoka window panels and frames.',
    image: P('jharoka-floral-plaque.jpg'),
    subs: [
      { slug: 'arch-panels', name: 'Arch Panels' },
      { slug: 'window-frames', name: 'Window Frames' },
    ],
  },
  {
    slug: 'wall-decor', name: 'Wall Decor',
    desc: 'Heritage wall hangings and mirror sets for modern, minimalist spaces.',
    image: P('jharoka-mirror-triptych.webp'),
    subs: [
      { slug: 'wall-hangings', name: 'Wall Hangings' },
      { slug: 'mirror-sets', name: 'Mirror Sets' },
    ],
  },
  {
    slug: 'custom-orders', name: 'Custom Orders',
    desc: 'Bespoke, made-to-order Lippan and Jharoka commissions, personalised for you.',
    image: P('lippan-flower-lavender.jpg'),
    subs: [],
  },
];

// Product slug → sub-category slug (products without an entry sit in the parent only).
const SUBCAT: Record<string, string> = {
  'marigold-mirror-lippan-plate': 'mirror-plates',
  'amethyst-lippan-mandala': 'mandalas',
  'festival-lippan-mandala': 'mandalas',
  'lavender-petal-lippan-flower': 'mandalas',
  'floral-jharoka-wall-plaque': 'arch-panels',
  'jharoka-mud-art-window': 'window-frames',
  'spring-birds-jharoka-hanging': 'arch-panels',
  'carved-jharokha-mirror-triptych': 'mirror-sets',
  'heritage-jharoka-niche-frame': 'wall-hangings',
  'rangoli-lippan-wall-mandala': 'wall-hangings',
};

interface Spec {
  name: string;
  slug: string;
  cat: string;
  brand: string;
  condition: string;
  base: string;
  sale?: string;
  feat?: number;
  img: string;
  stock?: number;
}

const PRODUCTS: Spec[] = [
  { name: 'Marigold Mirror Lippan Plate', slug: 'marigold-mirror-lippan-plate', cat: 'lippan-art', brand: "Saima's Atelier", condition: 'Handcrafted', base: '3800.00', sale: '3200.00', feat: 0, img: P('lippan-mandala-marigold.avif'), stock: 3 },
  { name: 'Amethyst Lippan Mirror Mandala', slug: 'amethyst-lippan-mandala', cat: 'lippan-art', brand: "Saima's Atelier", condition: 'Handcrafted', base: '4200.00', feat: 1, img: P('lippan-mandala-amethyst.jpg'), stock: 2 },
  { name: 'Festival Lippan Mandala Plate', slug: 'festival-lippan-mandala', cat: 'lippan-art', brand: "Saima's Atelier", condition: 'Handcrafted', base: '4600.00', sale: '3900.00', img: P('lippan-mandala-festival.jpg'), stock: 4 },
  { name: 'Lavender Petal Lippan Flower', slug: 'lavender-petal-lippan-flower', cat: 'lippan-art', brand: "Saima's Atelier", condition: 'Handcrafted', base: '2900.00', feat: 3, img: P('lippan-flower-lavender.jpg'), stock: 5 },
  { name: 'Floral Jharoka Wall Plaque', slug: 'floral-jharoka-wall-plaque', cat: 'jharokas', brand: "Saima's Atelier", condition: 'Hand-painted', base: '5400.00', sale: '4700.00', feat: 2, img: P('jharoka-floral-plaque.jpg'), stock: 2 },
  { name: 'Jharoka Mud-Art Window Panel', slug: 'jharoka-mud-art-window', cat: 'jharokas', brand: "Saima's Atelier", condition: 'Handcrafted', base: '6200.00', feat: 4, img: P('jharoka-mud-art-window.webp'), stock: 1 },
  { name: 'Spring Birds Jharoka Hanging', slug: 'spring-birds-jharoka-hanging', cat: 'jharokas', brand: "Saima's Atelier", condition: 'Handcrafted', base: '4800.00', sale: '4100.00', img: P('jharoka-spring-birds.webp'), stock: 3 },
  { name: 'Carved Jharokha Mirror Triptych', slug: 'carved-jharokha-mirror-triptych', cat: 'wall-decor', brand: "Saima's Atelier", condition: 'Handcrafted', base: '7800.00', feat: 5, img: P('jharoka-mirror-triptych.webp'), stock: 2 },
  { name: 'Heritage Jharoka Niche Frame', slug: 'heritage-jharoka-niche-frame', cat: 'wall-decor', brand: "Saima's Atelier", condition: 'Hand-painted', base: '5200.00', img: P('jharoka-mud-art-window.webp'), stock: 2 },
  { name: 'Rangoli Lippan Wall Mandala', slug: 'rangoli-lippan-wall-mandala', cat: 'wall-decor', brand: "Saima's Atelier", condition: 'Handcrafted', base: '4400.00', sale: '3700.00', img: P('lippan-mandala-festival.jpg'), stock: 4 },
  { name: 'Custom Lippan Name Mandala', slug: 'custom-lippan-name-mandala', cat: 'custom-orders', brand: "Saima's Atelier", condition: 'Made to order', base: '5000.00', img: P('lippan-mandala-marigold.avif'), stock: 10 },
  { name: 'Bespoke Jharoka Portrait Frame', slug: 'bespoke-jharoka-portrait-frame', cat: 'custom-orders', brand: "Saima's Atelier", condition: 'Made to order', base: '6800.00', img: P('jharoka-floral-plaque.jpg'), stock: 8 },
];

const REVIEWS: Record<string, { author: string; rating: number; title: string; body: string }[]> = {
  'marigold-mirror-lippan-plate': [
    { author: 'Naila R.', rating: 5, title: 'Stunning mirror work', body: 'The little mirrors catch the light beautifully — even prettier in person. Shipped quickly!' },
    { author: 'Tasnim A.', rating: 4, title: 'Lovely piece', body: 'Gorgeous colours and very well packed. A real statement on our wall.' },
  ],
  'floral-jharoka-wall-plaque': [
    { author: 'Imran H.', rating: 5, title: 'Heirloom quality', body: 'The hand-painting is so detailed. It has become the centrepiece of our hallway.' },
  ],
  'carved-jharokha-mirror-triptych': [
    { author: 'Sadia K.', rating: 5, title: 'Transformed our wall', body: 'The three panels look incredible together. Solid and beautifully made.' },
    { author: 'Rezaul M.', rating: 4, title: 'Beautiful craft', body: 'Lovely fretwork and mirrors. Slight handmade variation only adds character.' },
  ],
  'amethyst-lippan-mandala': [
    { author: 'Farah N.', rating: 5, title: 'My new favourite', body: 'The amethyst tones are rich and the mirrors sparkle. Worth every taka.' },
  ],
  'spring-birds-jharoka-hanging': [
    { author: 'Mehjabin S.', rating: 5, title: 'So charming', body: 'The little birds and tassels are adorable. Brightened our reading nook instantly.' },
  ],
};

function baseSku(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
}

function description(name: string, brand: string, condition: string): string {
  return `<p>A handcrafted <strong>${name.toLowerCase()}</strong> from ${brand}. ${condition}.</p>
  <ul><li>Traditional Kutchi Lippan mirror &amp; clay relief / Jharoka heritage art</li><li>Sealed, finished and ready to hang</li><li>Ships within 3–5 business days across Bangladesh</li></ul>
  <p>As every piece is made by hand, expect small, beautiful variations unique to yours.</p>`;
}

async function clearDemo(): Promise<void> {
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
  for (const t of DEMO_TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
}

async function main(): Promise<void> {
  console.log('Clearing demo data…');
  await clearDemo();

  // --- Admin -------------------------------------------------------------
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@saimasvintage.test';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { isActive: true },
    create: {
      email: adminEmail,
      name: 'Saima (Admin)',
      role: Role.ADMIN,
      passwordHash: await bcrypt.hash(adminPassword, 10),
    },
  });

  // --- Categories --------------------------------------------------------
  const catIds: Record<string, string> = {};
  let sort = 0;
  for (const c of CATEGORY_TREE) {
    const parent = await prisma.category.create({
      data: {
        name: c.name,
        slug: c.slug,
        description: c.desc,
        imageUrl: c.image,
        isActive: true,
        sortOrder: sort++,
        seoTitle: `${c.name} — Saima's Vintage`,
        seoDescription: c.desc,
      },
    });
    catIds[c.slug] = parent.id;

    let subSort = 0;
    for (const s of c.subs) {
      const sub = await prisma.category.create({
        data: {
          name: s.name,
          slug: s.slug,
          description: `${s.name} — handcrafted ${c.name.toLowerCase()}.`,
          parentId: parent.id,
          isActive: true,
          sortOrder: subSort++,
          seoTitle: `${s.name} — Saima's Vintage`,
        },
      });
      catIds[s.slug] = sub.id;
    }
  }

  // --- Size attribute (kept for schema parity; pieces are one-of-a-kind) --
  const sizeAttr = await prisma.productAttribute.create({
    data: { name: 'Size', slug: 'size' },
  });
  const sizeIds: Record<string, string> = {};
  for (const value of ['S', 'M', 'L']) {
    const v = await prisma.attributeValue.create({
      data: { attributeId: sizeAttr.id, value, slug: value.toLowerCase() },
    });
    sizeIds[value] = v.id;
  }
  void sizeIds;

  // --- Products ----------------------------------------------------------
  for (const spec of PRODUCTS) {
    const sku = baseSku(spec.slug);
    const images = [
      { url: spec.img, alt: spec.name, position: 0, isPrimary: true },
    ];

    const variants = [
      {
        sku: `${sku}-OS`,
        name: 'One piece',
        stock: spec.stock ?? 1,
        position: 0,
      },
    ];

    await prisma.product.create({
      data: {
        name: spec.name,
        slug: spec.slug,
        sku,
        shortDescription: `${spec.condition} · ${spec.brand}`,
        description: description(spec.name, spec.brand, spec.condition),
        brand: spec.brand,
        condition: spec.condition,
        basePrice: spec.base,
        salePrice: spec.sale ?? null,
        currency: 'BDT',
        isActive: true,
        isFeatured: spec.feat !== undefined,
        featuredOrder: spec.feat ?? 0,
        publishedAt: new Date(),
        categories: {
          create: [
            { categoryId: catIds[spec.cat] },
            ...(SUBCAT[spec.slug] && catIds[SUBCAT[spec.slug]]
              ? [{ categoryId: catIds[SUBCAT[spec.slug]] }]
              : []),
          ],
        },
        images: { create: images },
        variants: { create: variants },
      },
    });
  }

  // --- Reviews -----------------------------------------------------------
  for (const [slug, list] of Object.entries(REVIEWS)) {
    const product = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) continue;
    for (const r of list) {
      await prisma.review.create({
        data: {
          productId: product.id,
          authorName: r.author,
          rating: r.rating,
          title: r.title,
          body: r.body,
          isApproved: true,
        },
      });
    }
  }

  // --- Coupons -----------------------------------------------------------
  await prisma.coupon.createMany({
    data: [
      { code: 'WELCOME10', type: 'PERCENT', value: '10', isActive: true, usageLimit: 500 },
      { code: 'SUMMER20', type: 'PERCENT', value: '20', maxDiscount: '1500', minSubtotal: '4000', isActive: true },
      { code: 'FLAT500', type: 'FIXED', value: '500', minSubtotal: '3000', isActive: true, usageLimit: 100 },
    ],
  });

  // --- Customers + addresses --------------------------------------------
  const custHash = await bcrypt.hash('Customer123!', 10);
  const customers = [];
  for (const c of [
    { email: 'aisha@example.com', name: 'Aisha Rahman' },
    { email: 'kabir@example.com', name: 'Kabir Hossain' },
  ]) {
    const created = await prisma.customer.create({
      data: {
        email: c.email,
        name: c.name,
        passwordHash: custHash,
        phone: '01700000000',
        emailVerifiedAt: new Date(),
        addresses: {
          create: {
            fullName: c.name,
            phone: '01700000000',
            line1: 'House 12, Road 7, Dhanmondi',
            city: 'Dhaka',
            district: 'Dhaka',
            postalCode: '1209',
            country: 'Bangladesh',
            isDefault: true,
          },
        },
      },
    });
    customers.push(created);
  }

  // --- Orders (varied statuses, for admin + analytics visuals) ----------
  const variants = await prisma.productVariant.findMany({
    include: { product: true },
    take: 12,
  });
  const orderPlans: { status: OrderStatus; customerIdx?: number }[] = [
    { status: OrderStatus.PAID, customerIdx: 0 },
    { status: OrderStatus.PAID, customerIdx: 1 },
    { status: OrderStatus.PROCESSING, customerIdx: 0 },
    { status: OrderStatus.SHIPPED },
    { status: OrderStatus.AWAITING_PAYMENT },
    { status: OrderStatus.PAYMENT_REVIEW },
    { status: OrderStatus.CANCELLED },
  ];

  let seq = 0;
  for (const plan of orderPlans) {
    seq += 1;
    const v = variants[rnd(variants.length)];
    const qty = 1;
    const unit = Number(v.price ?? v.product.basePrice);
    const lineTotal = unit * qty;
    const paid = [
      OrderStatus.PAID,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ].includes(plan.status);
    const cust = plan.customerIdx !== undefined ? customers[plan.customerIdx] : null;
    const uniq = `${Date.now().toString(36)}${seq}${rnd(9999)}`;

    await prisma.order.create({
      data: {
        orderNumber: `SV${uniq.toUpperCase()}`,
        email: cust?.email ?? 'guest@example.com',
        phone: '01700000000',
        customerId: cust?.id ?? null,
        status: plan.status,
        currency: 'BDT',
        subtotal: lineTotal.toFixed(2),
        grandTotal: lineTotal.toFixed(2),
        idempotencyKey: `seed-${uniq}`,
        shipName: cust?.name ?? 'Guest Buyer',
        shipPhone: '01700000000',
        shipLine1: 'House 12, Road 7, Dhanmondi',
        shipCity: 'Dhaka',
        shipDistrict: 'Dhaka',
        shipPostalCode: '1209',
        shipCountry: 'Bangladesh',
        paidAt: paid ? new Date() : null,
        items: {
          create: {
            variantId: v.id,
            productName: v.product.name,
            variantName: v.name,
            sku: v.sku,
            unitPrice: unit.toFixed(2),
            quantity: qty,
            lineTotal: lineTotal.toFixed(2),
          },
        },
        payments: {
          create: {
            status: paid
              ? PaymentStatus.PAID
              : plan.status === OrderStatus.PAYMENT_REVIEW
                ? PaymentStatus.PAYMENT_REVIEW
                : plan.status === OrderStatus.CANCELLED
                  ? PaymentStatus.CANCELLED
                  : PaymentStatus.PENDING,
            amount: lineTotal.toFixed(2),
            currency: 'BDT',
            tranId: `SEEDTRAN-${uniq}`,
            valId: paid ? `SEEDVAL-${uniq}` : null,
            validatedAt: paid ? new Date() : null,
          },
        },
      },
    });
  }

  // --- CMS pages + blog --------------------------------------------------
  await prisma.pageContent.createMany({
    data: [
      {
        type: 'page',
        title: 'About Saima\'s Vintage',
        slug: 'about',
        excerpt: 'Handcrafted heritage, one piece at a time.',
        body: '<p>Saima\'s Vintage is a small, lovingly run studio dedicated to handcrafted Lippan mirror art and Jharoka heritage pieces. Every piece is made and finished by hand before it reaches you.</p><p>We ship across Bangladesh and stand behind every item we make.</p>',
        status: ContentStatus.PUBLISHED,
        publishedAt: new Date(),
        seoTitle: 'About — Saima\'s Vintage',
        seoDescription: 'The story behind Saima\'s Vintage handcrafted Lippan & Jharoka art.',
      },
      {
        type: 'page',
        title: 'Shipping & Returns',
        slug: 'shipping-returns',
        excerpt: 'How delivery and returns work.',
        body: '<p>Orders ship within 3–5 business days. Because each piece is handmade and unique, returns are accepted within 7 days for store credit.</p>',
        status: ContentStatus.PUBLISHED,
        publishedAt: new Date(),
      },
      {
        type: 'blog',
        title: 'Caring for Lippan Mirror Art',
        slug: 'caring-for-lippan-art',
        excerpt: 'Keep your mirror work sparkling for years.',
        body: '<p>Lippan art loves a gentle touch. Dust lightly with a soft, dry brush, keep it away from damp walls, and avoid harsh cleaners so the mirrors keep their shine.</p>',
        status: ContentStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    ],
  });

  // Summary
  const [products, cats, orders, reviews, coupons] = await Promise.all([
    prisma.product.count(),
    prisma.category.count(),
    prisma.order.count(),
    prisma.review.count(),
    prisma.coupon.count(),
  ]);
  console.log(
    `✓ Seeded: ${products} products, ${cats} categories, ${orders} orders, ${reviews} reviews, ${coupons} coupons`,
  );
  console.log(`✓ Admin: ${adminEmail} / ${adminPassword}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
