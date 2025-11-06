package signature

import (
	"context"
)

type SignatureService struct {
	ctx context.Context
}

func NewSignatureService() *SignatureService {
	return &SignatureService{}
}

func (s *SignatureService) Startup(ctx context.Context) {
	s.ctx = ctx
}
