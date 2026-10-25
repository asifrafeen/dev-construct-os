import { useMutation, useQuery } from '@tanstack/react-query';
import { signupLinks, type GenerateSignupLinkInput } from './api';

export const useSignupLinkConfigurations = (includeInactive = false) =>
  useQuery({
    queryKey: ['iam', 'signup-links', 'configurations', includeInactive],
    queryFn: () => signupLinks.configurations({ includeInactive }),
  });

export const useGenerateSignupLink = () =>
  useMutation({ mutationFn: (input: GenerateSignupLinkInput) => signupLinks.generate(input) });
