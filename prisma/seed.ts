import {
  ContentStatus,
  OrderStatus,
  PaymentStatus,
  PrismaClient,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Remote placeholder imagery (CSP allows https: images). Deterministic per seed.
const img = (seed: string, w = 800, h = 1000) =>
  `https://picsum.photos/seed/sv-${seed}/${w}/${h}`;

const rnd = (n: number) => Math.floor(Math.random() * n);

// Demo tables to wipe before reseeding (User is preserved/ upserted separately).
const DEMO_TABLES = [
  'AdminAuditLog', 'PaymentEvent', 'Payment', 'SslcommerzSession',
  'CouponRedemption', 'Shipment', 'OrderItem', 'Order', 'Coupon',
  'InventoryReservation', 'InventoryMovement', 'LowStockNotification',
  'CartItem', 'Cart', 'Review', 'WishlistItem', 'Wishlist',
  'ProductVariantAttributeValue', 'AttributeValue', 'ProductAttribute',
  'ProductImage', 'ProductVariant', 'ProductTranslation', 'CategoryProduct',
  'Product', 'Category', 'Redirect', 'Address', 'Customer',
  'NewsletterSubscriber', 'PageContent', 'SeoMeta', 'Job',
];

const CATEGORY_TREE = [
  {
    slug: 'dresses', name: 'Vintage Dresses', desc: 'One-of-a-kind dresses from every era.',
    subs: [
      { slug: 'tea-dresses', name: 'Tea Dresses' },
      { slug: 'maxi-dresses', name: 'Maxi Dresses' },
      { slug: 'evening-gowns', name: 'Evening Gowns' },
    ],
  },
  {
    slug: 'outerwear', name: 'Outerwear & Coats', desc: 'Coats, jackets and blazers with history.',
    subs: [
      { slug: 'coats', name: 'Coats' },
      { slug: 'jackets', name: 'Jackets' },
      { slug: 'blazers', name: 'Blazers' },
    ],
  },
  {
    slug: 'accessories', name: 'Accessories', desc: 'Scarves, belts, hats and more.',
    subs: [
      { slug: 'scarves', name: 'Scarves' },
      { slug: 'hats', name: 'Hats' },
      { slug: 'belts', name: 'Belts' },
    ],
  },
  {
    slug: 'bags', name: 'Bags & Purses', desc: 'Handpicked vintage bags.',
    subs: [
      { slug: 'handbags', name: 'Handbags' },
      { slug: 'clutches', name: 'Clutches' },
    ],
  },
  {
    slug: 'footwear', name: 'Footwear', desc: 'Boots, loafers and heels.',
    subs: [
      { slug: 'boots', name: 'Boots' },
      { slug: 'loafers', name: 'Loafers' },
    ],
  },
  {
    slug: 'jewelry', name: 'Jewelry', desc: 'Brooches, earrings and statement pieces.',
    subs: [
      { slug: 'earrings', name: 'Earrings' },
      { slug: 'necklaces', name: 'Necklaces' },
      { slug: 'rings', name: 'Rings' },
    ],
  },
];

// Product slug → sub-category slug (products without an entry sit in the parent only).
const SUBCAT: Record<string, string> = {
  'silk-tea-dress-1960s': 'tea-dresses',
  'floral-maxi-dress-1970s': 'maxi-dresses',
  'velvet-evening-gown': 'evening-gowns',
  'power-shoulder-dress-1980s': 'evening-gowns',
  'wool-herringbone-coat': 'coats',
  'leather-bomber-jacket': 'jackets',
  'tweed-blazer': 'blazers',
  'silk-patterned-scarf': 'scarves',
  'tan-leather-belt': 'belts',
  'felt-fedora-hat': 'hats',
  'structured-top-handle-bag': 'handbags',
  'beaded-evening-clutch': 'clutches',
  'canvas-weekender-bag': 'handbags',
  'leather-ankle-boots': 'boots',
  'suede-loafers': 'loafers',
  'pearl-drop-earrings': 'earrings',
  'gold-chain-necklace': 'necklaces',
  'cocktail-statement-ring': 'rings',
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
  imgs: number;
  stock?: number;
  sizes?: { size: string; stock: number }[];
}

const PRODUCTS: Spec[] = [
  { name: '1960s Silk Tea Dress', slug: 'silk-tea-dress-1960s', cat: 'dresses', brand: 'Unbranded', condition: 'Excellent', base: '4500.00', sale: '3800.00', feat: 0, imgs: 3, sizes: [{ size: 'S', stock: 1 }, { size: 'M', stock: 2 }, { size: 'L', stock: 0 }] },
  { name: '1970s Floral Maxi Dress', slug: 'floral-maxi-dress-1970s', cat: 'dresses', brand: 'Boho House', condition: 'Very Good', base: '5200.00', sale: '4400.00', feat: 1, imgs: 2, stock: 1 },
  { name: 'Velvet Evening Gown', slug: 'velvet-evening-gown', cat: 'dresses', brand: 'Maison Noir', condition: 'Excellent', base: '8900.00', imgs: 2, stock: 2 },
  { name: '1980s Power-Shoulder Dress', slug: 'power-shoulder-dress-1980s', cat: 'dresses', brand: 'Retro Co', condition: 'Good', base: '3900.00', sale: '2900.00', imgs: 2, stock: 0 },
  { name: 'Wool Herringbone Coat', slug: 'wool-herringbone-coat', cat: 'outerwear', brand: 'Highland Mills', condition: 'Excellent', base: '7600.00', feat: 2, imgs: 3, sizes: [{ size: 'S', stock: 1 }, { size: 'M', stock: 1 }, { size: 'L', stock: 2 }] },
  { name: 'Leather Bomber Jacket', slug: 'leather-bomber-jacket', cat: 'outerwear', brand: 'Aviator', condition: 'Very Good', base: '6800.00', sale: '5900.00', imgs: 2, stock: 3 },
  { name: 'Tweed Blazer', slug: 'tweed-blazer', cat: 'outerwear', brand: 'Country Club', condition: 'Good', base: '4200.00', imgs: 2, stock: 4 },
  { name: 'Silk Patterned Scarf', slug: 'silk-patterned-scarf', cat: 'accessories', brand: 'Soie', condition: 'Excellent', base: '2200.00', sale: '1800.00', feat: 3, imgs: 2, stock: 6 },
  { name: 'Tan Leather Belt', slug: 'tan-leather-belt', cat: 'accessories', brand: 'Saddler', condition: 'Very Good', base: '1500.00', imgs: 1, stock: 10 },
  { name: 'Cat-Eye Sunglasses', slug: 'cat-eye-sunglasses', cat: 'accessories', brand: 'Riviera', condition: 'Good', base: '1900.00', imgs: 2, stock: 5 },
  { name: 'Felt Fedora Hat', slug: 'felt-fedora-hat', cat: 'accessories', brand: 'Hatter & Co', condition: 'Very Good', base: '2400.00', sale: '1900.00', imgs: 2, stock: 2 },
  { name: 'Structured Top-Handle Bag', slug: 'structured-top-handle-bag', cat: 'bags', brand: 'Maroquinerie', condition: 'Excellent', base: '6900.00', feat: 4, imgs: 3, stock: 1 },
  { name: 'Beaded Evening Clutch', slug: 'beaded-evening-clutch', cat: 'bags', brand: 'Soirée', condition: 'Very Good', base: '3100.00', sale: '2600.00', imgs: 2, stock: 4 },
  { name: 'Canvas Weekender Bag', slug: 'canvas-weekender-bag', cat: 'bags', brand: 'Voyage', condition: 'Good', base: '4500.00', imgs: 2, stock: 3 },
  { name: 'Leather Ankle Boots', slug: 'leather-ankle-boots', cat: 'footwear', brand: 'Cobbler', condition: 'Very Good', base: '5800.00', feat: 5, imgs: 2, stock: 2 },
  { name: 'Suede Loafers', slug: 'suede-loafers', cat: 'footwear', brand: 'Mocassino', condition: 'Good', base: '4100.00', sale: '3300.00', imgs: 2, stock: 0 },
  { name: 'Art Deco Brooch', slug: 'art-deco-brooch', cat: 'jewelry', brand: 'Atelier', condition: 'Excellent', base: '2800.00', imgs: 1, stock: 3 },
  { name: 'Pearl Drop Earrings', slug: 'pearl-drop-earrings', cat: 'jewelry', brand: 'Lustre', condition: 'Excellent', base: '3400.00', sale: '2700.00', imgs: 2, stock: 5 },
  { name: 'Gold Chain Necklace', slug: 'gold-chain-necklace', cat: 'jewelry', brand: 'Orfèvre', condition: 'Very Good', base: '5200.00', imgs: 2, stock: 2 },
  { name: 'Cocktail Statement Ring', slug: 'cocktail-statement-ring', cat: 'jewelry', brand: 'Atelier', condition: 'Good', base: '2100.00', imgs: 1, stock: 4 },
];

const REVIEWS: Record<string, { author: string; rating: number; title: string; body: string }[]> = {
  'silk-tea-dress-1960s': [
    { author: 'Naila R.', rating: 5, title: 'Absolutely stunning', body: 'The silk is in beautiful condition and the fit is perfect. Shipped quickly!' },
    { author: 'Tasnim A.', rating: 4, title: 'Lovely piece', body: 'Gorgeous dress, slightly smaller than expected but still wonderful.' },
  ],
  'wool-herringbone-coat': [
    { author: 'Imran H.', rating: 5, title: 'Timeless', body: 'Heavy, warm and beautifully made. Looks even better in person.' },
  ],
  'leather-bomber-jacket': [
    { author: 'Sadia K.', rating: 5, title: 'Buttery leather', body: 'Such a great find — the leather has aged perfectly.' },
    { author: 'Rezaul M.', rating: 4, title: 'Great jacket', body: 'Fits true to size. Minor wear adds character.' },
  ],
  'structured-top-handle-bag': [
    { author: 'Farah N.', rating: 5, title: 'My new favourite', body: 'Structured, elegant, and the hardware is pristine.' },
  ],
  'pearl-drop-earrings': [
    { author: 'Mehjabin S.', rating: 5, title: 'Elegant', body: 'Delicate and classy. Wore them to a wedding and got compliments.' },
  ],
  'leather-ankle-boots': [
    { author: 'Arif J.', rating: 4, title: 'Solid boots', body: 'Comfortable after a short break-in. Quality leather.' },
  ],
};

function baseSku(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
}

function description(name: string, brand: string, condition: string): string {
  return `<p>A carefully selected <strong>${name.toLowerCase()}</strong>${brand && brand !== 'Unbranded' ? ` by ${brand}` : ''}. Condition: ${condition}.</p>
  <ul><li>One-of-a-kind vintage piece</li><li>Inspected and gently cleaned</li><li>Ships within 2 business days across Bangladesh</li></ul>
  <p>As with all vintage, expect minor signs of age that add to its character.</p>`;
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
        imageUrl: img(`cat-${c.slug}`, 1200, 600),
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
          description: `${s.name} — curated vintage ${c.name.toLowerCase()}.`,
          parentId: parent.id,
          isActive: true,
          sortOrder: subSort++,
          seoTitle: `${s.name} — Saima's Vintage`,
        },
      });
      catIds[s.slug] = sub.id;
    }
  }

  // --- Size attribute ----------------------------------------------------
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

  // --- Products ----------------------------------------------------------
  for (const spec of PRODUCTS) {
    const sku = baseSku(spec.slug);
    const images = Array.from({ length: spec.imgs }, (_, i) => ({
      url: img(`${spec.slug}-${i}`),
      alt: spec.name,
      position: i,
      isPrimary: i === 0,
    }));

    const variants = spec.sizes
      ? spec.sizes.map((s) => ({
          sku: `${sku}-${s.size}`,
          name: `Size ${s.size}`,
          stock: s.stock,
          position: 0,
          attributeValues: { create: [{ attributeValueId: sizeIds[s.size] }] },
        }))
      : [
          {
            sku: `${sku}-OS`,
            name: 'One size',
            stock: spec.stock ?? 1,
            position: 0,
          },
        ];

    await prisma.product.create({
      data: {
        name: spec.name,
        slug: spec.slug,
        sku,
        shortDescription: `${spec.condition} condition · ${spec.brand}`,
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

  // --- Newsletter --------------------------------------------------------
  await prisma.newsletterSubscriber.createMany({
    data: [
      { email: 'subscriber1@example.com', isConfirmed: true },
      { email: 'subscriber2@example.com', isConfirmed: true },
      { email: 'subscriber3@example.com', isConfirmed: false },
      { email: 'subscriber4@example.com', isConfirmed: true },
    ],
  });

  // --- CMS pages + blog --------------------------------------------------
  await prisma.pageContent.createMany({
    data: [
      {
        type: 'page',
        title: 'About Saima\'s Vintage',
        slug: 'about',
        excerpt: 'Curated vintage, one piece at a time.',
        body: '<p>Saima\'s Vintage is a small, lovingly run shop dedicated to one-of-a-kind vintage finds. Every piece is hand-selected, inspected, and gently cleaned before it reaches you.</p><p>We ship across Bangladesh and stand behind every item we sell.</p>',
        status: ContentStatus.PUBLISHED,
        publishedAt: new Date(),
        seoTitle: 'About — Saima\'s Vintage',
        seoDescription: 'The story behind Saima\'s Vintage.',
      },
      {
        type: 'page',
        title: 'Shipping & Returns',
        slug: 'shipping-returns',
        excerpt: 'How delivery and returns work.',
        body: '<p>Orders ship within 2 business days. Because each item is unique, returns are accepted within 7 days for store credit.</p>',
        status: ContentStatus.PUBLISHED,
        publishedAt: new Date(),
      },
      {
        type: 'blog',
        title: 'How to Care for Vintage Silk',
        slug: 'care-for-vintage-silk',
        excerpt: 'Keep your silk pieces beautiful for decades.',
        body: '<p>Vintage silk deserves gentle care. Hand wash cold, never wring, and dry flat away from direct sun.</p>',
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
