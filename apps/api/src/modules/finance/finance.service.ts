import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceQueryDto } from './finance.dto';

/**
 * Finance module service scaffold.
 * Domain logic (ledgers, vouchers, budgets, etc.) will land here.
 */
@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  /** Health / readiness probe for the Finance module. */
  getStatus() {
    return {
      module: 'finance',
      status: 'ready',
      message: 'Finance module scaffold is registered',
    };
  }

  /**
   * Placeholder list endpoint. Returns an empty collection until
   * Finance entities are modeled and implemented.
   */
  async findAll(_query: FinanceQueryDto) {
    void _query;
    return {
      items: [],
      total: 0,
    };
  }
}
