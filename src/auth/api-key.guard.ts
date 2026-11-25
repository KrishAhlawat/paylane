import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Merchant } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { hashApiKey, parseBearerKey } from './api-key';

export interface AuthedRequest extends Request {
  merchant: Merchant;
}

/** Authenticates `Authorization: Bearer pl_test_...` and attaches the merchant to the request. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const key = parseBearerKey(req.headers['authorization']);
    if (!key) {
      throw new UnauthorizedException('Missing or malformed API key');
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { apiKeyHash: hashApiKey(key) },
    });
    if (!merchant) {
      throw new UnauthorizedException('Invalid API key');
    }

    req.merchant = merchant;
    return true;
  }
}
