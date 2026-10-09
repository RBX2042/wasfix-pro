-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CONSUMER',
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "stripeCustomerId" TEXT,
    "stripeSubId" TEXT,
    "diagnosesUsed" INTEGER NOT NULL DEFAULT 0,
    "diagnosesResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "referralCode" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WashingMachine" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "imageUrl" TEXT,
    "description" TEXT,

    CONSTRAINT "WashingMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedMachine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "nickname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "likelyCauses" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "diyFriendly" BOOLEAN NOT NULL DEFAULT true,
    "provenance" TEXT NOT NULL DEFAULT 'REPORTED',
    "sourceUrl" TEXT,
    "sourceName" TEXT,

    CONSTRAINT "ErrorCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairGuide" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "machineId" TEXT,
    "difficulty" TEXT NOT NULL DEFAULT 'MEDIUM',
    "timeMinutes" INTEGER NOT NULL,
    "steps" TEXT NOT NULL,
    "tools" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "warnings" TEXT,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "priceEur" DOUBLE PRECISION NOT NULL,
    "costEur" DOUBLE PRECISION,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "isOriginal" BOOLEAN NOT NULL DEFAULT true,
    "supplier" TEXT,

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartMachine" (
    "partId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,

    CONSTRAINT "PartMachine_pkey" PRIMARY KEY ("partId","machineId")
);

-- CreateTable
CREATE TABLE "ErrorCodeParts" (
    "errorCodeId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,

    CONSTRAINT "ErrorCodeParts_pkey" PRIMARY KEY ("errorCodeId","partId")
);

-- CreateTable
CREATE TABLE "ErrorCodeGuides" (
    "errorCodeId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,

    CONSTRAINT "ErrorCodeGuides_pkey" PRIMARY KEY ("errorCodeId","guideId")
);

-- CreateTable
CREATE TABLE "GuideParts" (
    "guideId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,

    CONSTRAINT "GuideParts_pkey" PRIMARY KEY ("guideId","partId")
);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT,
    "symptoms" TEXT NOT NULL,
    "messages" TEXT NOT NULL,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subtotalEur" DOUBLE PRECISION NOT NULL,
    "discountEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEur" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0.21,
    "vatEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatNumber" TEXT,
    "costEur" DOUBLE PRECISION,
    "stripePaymentId" TEXT,
    "shippingAddress" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'STRIPE',
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'read:parts,read:errorcodes,read:guides',
    "rateLimit" INTEGER NOT NULL DEFAULT 1000,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetSku" TEXT,
    "targetSlug" TEXT,
    "rating" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RmaRequest" (
    "id" TEXT NOT NULL,
    "rmaNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RmaRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonteurApplication" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "kvkNumber" TEXT NOT NULL,
    "vatNumber" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "contactName" TEXT NOT NULL,
    "yearsExperience" INTEGER,
    "coverageAreas" TEXT,
    "specializations" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonteurApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosisFeedback" (
    "id" TEXT NOT NULL,
    "diagnosisId" TEXT,
    "sessionId" TEXT,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosisFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "street" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "machine" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonteurProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT,
    "kvkNumber" TEXT,
    "vatNumber" TEXT,
    "street" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "iban" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0.21,
    "hourlyRateEur" DOUBLE PRECISION,
    "paymentTerms" INTEGER NOT NULL DEFAULT 14,
    "invoiceFooter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonteurProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonteurInvoice" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "subtotalEur" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION NOT NULL,
    "vatEur" DOUBLE PRECISION NOT NULL,
    "totalEur" DOUBLE PRECISION NOT NULL,
    "sellerJson" TEXT NOT NULL,
    "buyerJson" TEXT NOT NULL,
    "linesJson" TEXT NOT NULL,

    CONSTRAINT "MonteurInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonteurInvoiceSequence" (
    "ownerId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MonteurInvoiceSequence_pkey" PRIMARY KEY ("ownerId","year")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "customerId" TEXT,
    "reference" TEXT NOT NULL,
    "machine" TEXT,
    "errorCode" TEXT,
    "problem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "scheduledAt" TIMESTAMP(3),
    "priceEur" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerId" TEXT,
    "visitorId" TEXT NOT NULL,
    "landingPath" TEXT,
    "signedUpAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "rewardEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotalEur" DOUBLE PRECISION NOT NULL,
    "discountEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatRate" DOUBLE PRECISION NOT NULL,
    "vatEur" DOUBLE PRECISION NOT NULL,
    "totalEur" DOUBLE PRECISION NOT NULL,
    "sellerJson" TEXT NOT NULL,
    "buyerJson" TEXT NOT NULL,
    "linesJson" TEXT NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_plan_idx" ON "User"("plan");

-- CreateIndex
CREATE INDEX "WashingMachine_brand_idx" ON "WashingMachine"("brand");

-- CreateIndex
CREATE UNIQUE INDEX "WashingMachine_brand_model_key" ON "WashingMachine"("brand", "model");

-- CreateIndex
CREATE UNIQUE INDEX "SavedMachine_userId_machineId_key" ON "SavedMachine"("userId", "machineId");

-- CreateIndex
CREATE INDEX "ErrorCode_code_idx" ON "ErrorCode"("code");

-- CreateIndex
CREATE INDEX "ErrorCode_machineId_idx" ON "ErrorCode"("machineId");

-- CreateIndex
CREATE INDEX "ErrorCode_severity_idx" ON "ErrorCode"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorCode_code_machineId_key" ON "ErrorCode"("code", "machineId");

-- CreateIndex
CREATE UNIQUE INDEX "RepairGuide_slug_key" ON "RepairGuide"("slug");

-- CreateIndex
CREATE INDEX "RepairGuide_machineId_idx" ON "RepairGuide"("machineId");

-- CreateIndex
CREATE INDEX "RepairGuide_difficulty_idx" ON "RepairGuide"("difficulty");

-- CreateIndex
CREATE INDEX "RepairGuide_isPremium_idx" ON "RepairGuide"("isPremium");

-- CreateIndex
CREATE UNIQUE INDEX "Part_sku_key" ON "Part"("sku");

-- CreateIndex
CREATE INDEX "Part_brand_idx" ON "Part"("brand");

-- CreateIndex
CREATE INDEX "Part_category_idx" ON "Part"("category");

-- CreateIndex
CREATE INDEX "Diagnosis_sessionId_idx" ON "Diagnosis"("sessionId");

-- CreateIndex
CREATE INDEX "Diagnosis_userId_idx" ON "Diagnosis"("userId");

-- CreateIndex
CREATE INDEX "Diagnosis_createdAt_idx" ON "Diagnosis"("createdAt");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_stripePaymentId_idx" ON "Order"("stripePaymentId");

-- CreateIndex
CREATE INDEX "Order_paymentMethod_status_idx" ON "Order"("paymentMethod", "status");

-- CreateIndex
CREATE INDEX "Order_email_idx" ON "Order"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StripeEvent_stripeEventId_key" ON "StripeEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "StripeEvent_type_idx" ON "StripeEvent"("type");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_partId_idx" ON "OrderItem"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "Review_targetType_targetSku_idx" ON "Review"("targetType", "targetSku");

-- CreateIndex
CREATE INDEX "Review_targetType_targetSlug_idx" ON "Review"("targetType", "targetSlug");

-- CreateIndex
CREATE INDEX "Review_status_idx" ON "Review"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RmaRequest_rmaNumber_key" ON "RmaRequest"("rmaNumber");

-- CreateIndex
CREATE INDEX "RmaRequest_email_idx" ON "RmaRequest"("email");

-- CreateIndex
CREATE INDEX "RmaRequest_status_idx" ON "RmaRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MonteurApplication_applicationId_key" ON "MonteurApplication"("applicationId");

-- CreateIndex
CREATE INDEX "MonteurApplication_email_idx" ON "MonteurApplication"("email");

-- CreateIndex
CREATE INDEX "MonteurApplication_status_idx" ON "MonteurApplication"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");

-- CreateIndex
CREATE INDEX "DiagnosisFeedback_rating_idx" ON "DiagnosisFeedback"("rating");

-- CreateIndex
CREATE INDEX "DiagnosisFeedback_createdAt_idx" ON "DiagnosisFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "Customer_ownerId_idx" ON "Customer"("ownerId");

-- CreateIndex
CREATE INDEX "Customer_ownerId_name_idx" ON "Customer"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MonteurProfile_userId_key" ON "MonteurProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MonteurInvoice_workOrderId_key" ON "MonteurInvoice"("workOrderId");

-- CreateIndex
CREATE INDEX "MonteurInvoice_ownerId_year_idx" ON "MonteurInvoice"("ownerId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "MonteurInvoice_ownerId_number_key" ON "MonteurInvoice"("ownerId", "number");

-- CreateIndex
CREATE INDEX "WorkOrder_ownerId_status_idx" ON "WorkOrder"("ownerId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_customerId_idx" ON "WorkOrder"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_ownerId_reference_key" ON "WorkOrder"("ownerId", "reference");

-- CreateIndex
CREATE INDEX "Referral_code_idx" ON "Referral"("code");

-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE INDEX "Referral_visitorId_idx" ON "Referral"("visitorId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_code_visitorId_key" ON "Referral"("code", "visitorId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");

-- CreateIndex
CREATE INDEX "Invoice_year_idx" ON "Invoice"("year");

-- CreateIndex
CREATE INDEX "Invoice_issuedAt_idx" ON "Invoice"("issuedAt");

-- CreateIndex
CREATE INDEX "UsageCounter_windowEnd_idx" ON "UsageCounter"("windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_scope_key_key" ON "UsageCounter"("scope", "key");

-- AddForeignKey
ALTER TABLE "SavedMachine" ADD CONSTRAINT "SavedMachine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedMachine" ADD CONSTRAINT "SavedMachine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "WashingMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorCode" ADD CONSTRAINT "ErrorCode_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "WashingMachine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairGuide" ADD CONSTRAINT "RepairGuide_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "WashingMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartMachine" ADD CONSTRAINT "PartMachine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartMachine" ADD CONSTRAINT "PartMachine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "WashingMachine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorCodeParts" ADD CONSTRAINT "ErrorCodeParts_errorCodeId_fkey" FOREIGN KEY ("errorCodeId") REFERENCES "ErrorCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorCodeParts" ADD CONSTRAINT "ErrorCodeParts_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorCodeGuides" ADD CONSTRAINT "ErrorCodeGuides_errorCodeId_fkey" FOREIGN KEY ("errorCodeId") REFERENCES "ErrorCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorCodeGuides" ADD CONSTRAINT "ErrorCodeGuides_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "RepairGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideParts" ADD CONSTRAINT "GuideParts_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "RepairGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideParts" ADD CONSTRAINT "GuideParts_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonteurProfile" ADD CONSTRAINT "MonteurProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonteurInvoice" ADD CONSTRAINT "MonteurInvoice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonteurInvoice" ADD CONSTRAINT "MonteurInvoice_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

