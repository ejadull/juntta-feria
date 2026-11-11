import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { isUuid } from '../db/database.service.js';
import { parseBody } from '../http/parse-body.js';
import {
  MANAGERS,
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import {
  CategoriesService,
  type ExhibitorCategory,
} from './categories.service.js';
import { categoryInput } from './document.input.js';

const id = (value: string): string => {
  if (!isUuid(value)) throw new NotFoundException('Category not found.');
  return value;
};

/** EXH-02 (§5): rubros of the organization. Exhibitors read them to fill their profile. */
@Controller('exhibitor-categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @TenantScoped(...MANAGERS, 'EXHIBITOR')
  list(@Req() request: TenantRequest): Promise<ExhibitorCategory[]> {
    return this.categories.list(request.tenant.id);
  }

  @Post()
  @TenantScoped(...MANAGERS)
  create(
    @Req() request: TenantRequest,
    @Body() body: unknown,
  ): Promise<ExhibitorCategory> {
    return this.categories.create(
      request.tenant.id,
      request.user.id,
      parseBody(categoryInput, body, 'category'),
    );
  }

  @Patch(':id')
  @TenantScoped(...MANAGERS)
  update(
    @Req() request: TenantRequest,
    @Param('id') categoryId: string,
    @Body() body: unknown,
  ): Promise<ExhibitorCategory> {
    return this.categories.update(
      request.tenant.id,
      request.user.id,
      id(categoryId),
      parseBody(categoryInput, body, 'category'),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @TenantScoped(...MANAGERS)
  remove(
    @Req() request: TenantRequest,
    @Param('id') categoryId: string,
  ): Promise<void> {
    return this.categories.remove(
      request.tenant.id,
      request.user.id,
      id(categoryId),
    );
  }
}
