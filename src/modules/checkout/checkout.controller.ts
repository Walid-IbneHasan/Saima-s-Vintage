import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { PaymentsService } from '../payments/payments.service';
import { CheckoutService } from './checkout.service';
import { CheckoutDto } from './dto';

interface SessionCustomer {
  id: string;
  name: string;
  email: string;
}

@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly cart: CartService,
    private readonly checkout: CheckoutService,
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async form(@Req() req: Request, @Res() res: Response): Promise<void> {
    const cart = await this.cart.resolveCart(req, res, false);
    const view = await this.cart.getView(cart);
    if (view.items.length === 0) {
      res.redirect('/cart');
      return;
    }

    // Prefill from the logged-in account (email, name, phone, default address).
    const me = res.locals.currentCustomer as SessionCustomer | undefined;
    let prefill: Record<string, string> = {};
    let hasSavedAddress = false;
    if (me) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: me.id },
        select: { name: true, email: true, phone: true },
      });
      const address = await this.prisma.address.findFirst({
        where: { customerId: me.id },
        orderBy: { isDefault: 'desc' },
      });
      // A saved address the customer can reuse (or override) for this order.
      hasSavedAddress = !!(address && address.line1 && address.city);
      prefill = {
        email: customer?.email ?? me.email,
        name: customer?.name ?? me.name,
        phone: address?.phone || customer?.phone || '',
        shipPhone: address?.phone || customer?.phone || '',
        line1: address?.line1 ?? '',
        line2: address?.line2 ?? '',
        city: address?.city ?? '',
        district: address?.district ?? '',
        postalCode: address?.postalCode ?? '',
      };
    }

    res.render('pages/checkout', {
      title: 'Checkout',
      cart: view,
      idempotencyKey: randomUUID(),
      loggedIn: !!me,
      hasSavedAddress,
      prefill,
    });
  }

  @Post()
  async submit(
    @Body() dto: CheckoutDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cart = await this.cart.resolveCart(req, res, false);
    if (!cart) {
      res.redirect('/cart');
      return;
    }
    const key = dto.idempotencyKey || randomUUID();

    // If logged in, link the order to the account and trust the account email
    // (not the submitted field) so the order shows in their history. Verify the
    // customer still exists first — a stale session (e.g. after the account was
    // removed/reseeded) would otherwise fail the order's customerId foreign key
    // with a 500. Missing → fall back to a guest order with the submitted email.
    const me = res.locals.currentCustomer as SessionCustomer | undefined;
    let customerId: string | null = null;
    if (me) {
      const exists = await this.prisma.customer.findUnique({
        where: { id: me.id },
        select: { id: true },
      });
      if (exists) {
        customerId = me.id;
        dto.email = me.email;
      }
    }

    const order = await this.checkout.placeOrder(
      cart,
      dto,
      key,
      customerId,
      dto.paymentMethod,
    );

    // Cash on Delivery: the order is already confirmed — no gateway. Send the
    // confirmation and land on the order-complete page.
    if (dto.paymentMethod === 'cod') {
      await this.payments.confirmCodOrder(order.id);
      res.redirect(`/checkout/complete/${order.orderNumber}`);
      return;
    }

    // bKash: create the hosted-checkout payment and send the customer there.
    const gatewayUrl = await this.payments.createPaymentSession(order.id);
    if (gatewayUrl) {
      res.redirect(gatewayUrl);
      return;
    }
    // Session creation failed — order stays AWAITING_PAYMENT; show its status.
    res.redirect(`/checkout/complete/${order.orderNumber}`);
  }

  @Get('complete/:orderNumber')
  async complete(
    @Param('orderNumber') orderNumber: string,
    @Res() res: Response,
  ): Promise<void> {
    const order = await this.checkout.getOrderForConfirmation(orderNumber);
    if (!order) throw new NotFoundException('Order not found');
    res.render('pages/order-complete', {
      title: `Order ${order.orderNumber}`,
      order,
    });
  }
}
