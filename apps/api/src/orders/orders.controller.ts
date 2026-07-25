import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  idSchema,
  orderListQuerySchema,
  type Order,
  type OrderList,
  type OrderListQuery,
  type Role,
} from '@shop/shared';
import jwt from 'jsonwebtoken';
import { AuthGuard, type AuthedRequest, type ServiceTokenPayload } from '../auth/auth.guard';
import { CurrentUser, type CurrentUserInfo } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CONFIG, type AppConfig } from '../config/config';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** A signed-in customer's own history. */
  @UseGuards(AuthGuard)
  @Get()
  list(
    @CurrentUser() user: CurrentUserInfo,
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery,
  ): Promise<OrderList> {
    return this.orders.listForUser(user.id, query);
  }

  /**
   * Open to guests, because the confirmation link has to work without an
   * account. Access is decided in the service from the viewer's identity and,
   * for a guest, the `email` query parameter matching the order.
   */
  @Get(':id')
  getOne(
    @Req() request: AuthedRequest,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Query('email') email?: string,
    @Query('t') accessToken?: string,
  ): Promise<Order> {
    const session = this.optionalToken(request);
    return this.orders.getOrder(id, {
      userId: session?.sub ?? null,
      role: (session?.role as Role | undefined) ?? null,
      email: email ?? session?.email ?? null,
      token: accessToken,
    });
  }

  private optionalToken(request: AuthedRequest): ServiceTokenPayload | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      return jwt.verify(header.slice('Bearer '.length), this.config.authSecret, {
        algorithms: ['HS256'],
      }) as ServiceTokenPayload;
    } catch {
      return null;
    }
  }
}
