import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { CartService } from './cart.service';
import { AddToCartDto, UpdateCartItemDto } from './dto';

@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  async view(@Req() req: Request, @Res() res: Response): Promise<void> {
    const cart = await this.cart.resolveCart(req, res, false);
    const view = await this.cart.getView(cart);
    res.render('pages/cart', { title: 'Your cart', cart: view });
  }

  @Post('items')
  async add(
    @Body() dto: AddToCartDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cart = await this.cart.resolveCart(req, res, true);
    if (cart) await this.cart.addItem(cart, dto.variantId, dto.quantity);
    res.redirect('/cart');
  }

  @Post('items/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cart = await this.cart.resolveCart(req, res, false);
    if (cart) await this.cart.updateItem(cart, id, dto.quantity);
    res.redirect('/cart');
  }

  @Post('items/:id/delete')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cart = await this.cart.resolveCart(req, res, false);
    if (cart) await this.cart.removeItem(cart, id);
    res.redirect('/cart');
  }
}
