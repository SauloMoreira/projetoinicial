import { useEffect, useState, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCashSession } from '@/hooks/useCashSession';
import { formatCurrency, formatDate, todayISO, PAYMENT_METHODS, DOCUMENT_TYPES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import PhoneInput from '@/components/PhoneInput';
import FiadoChargeDialog from '@/components/FiadoChargeDialog';
import SPROperationalBlockCard from '@/components/SPROperationalBlockCard';
import SPRPaymentDialog from '@/components/SPRPaymentDialog';
import { toast } from 'sonner';
import {
  Heart, Plus, DollarSign, Search, Camera, Upload,
  User, Pencil, Loader2, AlertCircle, CheckCircle2,
  Clock, TrendingDown, Users, Receipt,
} from 'lucide-react';
import { applyPhoneMask } from '@/lib/masks';
import type { Database } from '@/integrations/supabase/types';
import { useNavigate } from 'react-router-dom';

type Volunteer = Database['public']['Tables']['spr_volunteers']['Row'] & {
  avatar_url?: string | null;
  open_balance?: number;
};
type FiadoCharge = Database['public']['Tables']['spr_fiado_charges']['Row'];
type DocumentType = Database['public']['Enums']['document_type'];

export default function SPRPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { sessionOpen, canOperate, responsibleName } = useCashSession();
  const canAccessOperationalSpr = profile?.role === 'admin' || canOperate;
  const showBlockedCard =
    (profile?.role === 'cashier' || profile?.role === 'cash_coordinator') &&
    !canAccessOperationalSpr;

  const [tab, setTab] = useState('volunteers');
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [charges, setCharges] = useState<(FiadoCharge & { volunteer_name?: string })[]>([]);
  const [search, setSearch] = useState('');
  const [loadingData, setLoadingData] = useState(false);

  // Volunteer form
  const [volDialogOpen, setVolDialogOpen] = useState(false);
  const [editingVol, setEditingVol] = useState<Volunteer | null>(null);
  const [volName, setVolName] = useState('');
  const [volPhone, setVolPhone] = useState('');
  const [volActive, setVolActive] = useState(true);
  const [volAvatarFile, setVolAvatarFile] = useState<File | null>(null);
  const [volPreviewUrl, setVolPreviewUrl] = useState<string | null>(null);
  const [volUploading, setVolUploading] = useState(false);
  const volFileRef = useRef<HTMLInputElement>(null);
  const volCameraRef = useRef<HTMLInputElement>(null);

  // Dialogs
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  // REDESIGN: Use SPRPaymentDialog (multi-step) instead of basic inline dialog
  const [sprPaymentOpen, setSprPaymentOpen] = useState(false);

  useEffect(() => {
    if (!canAccessOperationalSpr) {
      setVolunteers([]);
      setCharges([]);
      return;
    }
    fetchAll();
  }, [canAccessOperationalSpr]);

  const fetchAll = async () => {
    setLoadingData(true);
    await Promise.all([fetchVolunteers(), fetchCharges()]);
    setLoadingData(false);
  };

  const fetchVolunteers = async () => {
    const { data: volData } = await supabase.from('spr_volunteers').select('*').order('full_name');
    if (!volData) return;

    // REDESIGN: fetch open balances per volunteer so we can show them inline
    const { data: chargeData } = await supabase
      .from('spr_fiado_charges')
      .select('volunteer_id, amount, status')
      .in('status', ['open', 'partial']);

    const balanceMap: Record<string, number> = {};
    (chargeData || []).forEach((c: any) => {
      balanceMap[c.volunteer_id] = (balanceMap[c.volunteer_id] || 0) + Number(c.amount);
    });

    setVolunteers(
      (volData as Volunteer[]).map(v => ({ ...v, open_balance: balanceMap[v.id] || 0 }))
    );
  };

  const fetchCharges = async () => {
    const { data } = await supabase
      .from('spr_fiado_charges')
      .select('*, spr_volunteers(full_name)')
      .order('created_at', { ascending: false });
    if (data)
      setCharges(data.map((c: any) => ({ ...c, volunteer_name: c.spr_volunteers?.full_name })));
  };

  const openNewVolunteer = () => {
    setEditingVol(null);
    setVolName('');
    setVolPhone('');
    setVolActive(true);
    setVolAvatarFile(null);
    setVolPreviewUrl(null);
    setVolDialogOpen(true);
  };

  const openEditVolunteer = (v: Volunteer) => {
    setEditingVol(v);
    setVolName(v.full_name);
    setVolPhone(v.phone ? applyPhoneMask(v.phone) : '');
    setVolActive(v.is_active);
    setVolAvatarFile(null);
    setVolPreviewUrl(v.avatar_url || null);
    setVolDialogOpen(true);
  };

  const handleVolFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione uma imagem válida.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Máximo 5MB.');
      return;
    }
    setVolAvatarFile(file);
    setVolPreviewUrl(URL.createObjectURL(file));
  };

  const uploadVolAvatar = async (volunteerId: string): Promise<string | null> => {
    if (!volAvatarFile) return editingVol?.avatar_url || null;
    setVolUploading(true);
    const ext = volAvatarFile.name.split('.').pop() || 'jpg';
    const filePath = `volunteers/${volunteerId}.${ext}`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(filePath, volAvatarFile, { upsert: true });
    if (error) {
      toast.error('Erro ao enviar foto.');
      setVolUploading(false);
      return null;
    }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
    setVolUploading(false);
    return urlData.publicUrl + '?t=' + Date.now();
  };

  const saveVolunteer = async () => {
    if (!volName.trim()) {
      toast.error('Nome é obrigatório.');
      return;
    }
    if (editingVol) {
      let avatarUrl = editingVol.avatar_url;
      if (volAvatarFile) {
        avatarUrl = await uploadVolAvatar(editingVol.id);
        if (volAvatarFile && !avatarUrl) return;
      }
      const { error } = await supabase
        .from('spr_volunteers')
        .update({ full_name: volName, phone: volPhone || null, is_active: volActive, avatar_url: avatarUrl } as any)
        .eq('id', editingVol.id);
      if (error) toast.error(error.message);
      else {
        toast.success('Voluntário atualizado!');
        setVolDialogOpen(false);
        fetchVolunteers();
      }
    } else {
      const tempId = crypto.randomUUID();
      let avatarUrl: string | null = null;
      if (volAvatarFile) avatarUrl = await uploadVolAvatar(tempId);
      const { error } = await supabase
        .from('spr_volunteers')
        .insert({ id: tempId, full_name: volName, phone: volPhone || null, avatar_url: avatarUrl } as any);
      if (error) toast.error(error.message);
      else {
        toast.success('Voluntário cadastrado!');
        setVolDialogOpen(false);
        fetchVolunteers();
      }
    }
  };

  // Summary stats
  const totalOpen = useMemo(
    () => charges.filter(c => c.status !== 'paid').reduce((s, c) => s + Number(c.amount), 0),
    [charges]
  );
  const totalToday = useMemo(() => {
    const today = todayISO();
    return charges
      .filter(c => c.business_date === today)
      .reduce((s, c) => s + Number(c.amount), 0);
  }, [charges]);
  const volunteersWithBalance = useMemo(
    () => volunteers.filter(v => (v.open_balance || 0) > 0).length,
    [volunteers]
  );

  const filteredVol = useMemo(
    () =>
      !search
        ? volunteers
        : volunteers.filter(v => v.full_name.toLowerCase().includes(search.toLowerCase())),
    [volunteers, search]
  );

  const filteredCharges = useMemo(
    () =>
      !search
        ? charges
        : charges.filter(c =>
            c.volunteer_name?.toLowerCase().includes(search.toLowerCase())
          ),
    [charges, search]
  );

  const statusColor = (s: string) =>
    s === 'paid'
      ? 'bg-income/10 text-income'
      : s === 'partial'
      ? 'bg-warning/10 text-warning'
      : 'bg-expense/10 text-expense';

  const statusLabel = (s: string) =>
    s === 'paid' ? 'Pago' : s === 'partial' ? 'Parcial' : 'Em Aberto';

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="page-title flex items-center gap-2">
          <Heart className="h-5 w-5 text-primary" />
          SPR Ramatis
        </h1>
      </div>

      {showBlockedCard ? (
        <SPROperationalBlockCard
          responsibleName={sessionOpen ? responsibleName : null}
          hasOpenSession={sessionOpen}
          onRequestTransfer={sessionOpen ? () => navigate('/fechamento') : undefined}
        />
      ) : (
        <>
          {/* ── Summary Cards ── REDESIGN: 3 stats + botão Receber */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Total em aberto — destaque */}
            <Card className="col-span-2 border-warning/30 bg-gradient-to-br from-warning/5 to-transparent">
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning/10 shrink-0">
                    <TrendingDown className="h-5 w-5 text-warning" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Fiado em Aberto</p>
                    <p className="financial-value text-2xl text-warning">{formatCurrency(totalOpen)}</p>
                  </div>
                </div>
                {/* REDESIGN: botão de receber proeminente aqui */}
                <Button
                  className="h-10 gap-1.5 shrink-0"
                  onClick={() => setSprPaymentOpen(true)}
                >
                  <DollarSign className="h-4 w-4" />
                  Receber
                </Button>
              </CardContent>
            </Card>

            {/* Lançamentos hoje */}
            <Card className="stat-card">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Receipt className="h-4 w-4 text-primary" />
                  <span className="text-xs text-muted-foreground">Hoje</span>
                </div>
                <p className="financial-value text-lg text-primary">{formatCurrency(totalToday)}</p>
              </CardContent>
            </Card>

            {/* Voluntários com saldo */}
            <Card className="stat-card">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Users className="h-4 w-4 text-expense" />
                  <span className="text-xs text-muted-foreground">Com saldo</span>
                </div>
                <p className="financial-value text-lg text-expense">{volunteersWithBalance}</p>
              </CardContent>
            </Card>
          </div>

          {/* ── Tabs ── */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="volunteers" className="flex-1">
                Voluntários
                {volunteersWithBalance > 0 && (
                  <Badge variant="secondary" className="ml-1.5 bg-expense/10 text-expense text-[10px]">
                    {volunteersWithBalance}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="charges" className="flex-1">
                Fiados
                {charges.filter(c => c.status !== 'paid').length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 bg-warning/10 text-warning text-[10px]">
                    {charges.filter(c => c.status !== 'paid').length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <div className="mt-3">
              {/* Search */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-11 pl-10"
                />
              </div>

              {/* ── Voluntários Tab ── REDESIGN: mostra saldo individual */}
              <TabsContent value="volunteers" className="mt-0 space-y-2">
                <div className="flex justify-end">
                  <Button size="sm" onClick={openNewVolunteer}>
                    <Plus className="mr-1 h-4 w-4" />
                    Voluntário
                  </Button>
                </div>

                {loadingData ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredVol.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    Nenhum voluntário encontrado.
                  </p>
                ) : (
                  filteredVol.map(v => {
                    const balance = v.open_balance || 0;
                    return (
                      <Card
                        key={v.id}
                        className={`cursor-pointer hover:border-primary/30 transition-all ${
                          balance > 0 ? 'border-warning/20' : ''
                        }`}
                      >
                        <CardContent className="flex items-center justify-between p-3 gap-2">
                          {/* Avatar + info */}
                          <div
                            className="flex items-center gap-3 min-w-0 flex-1"
                            onClick={() => openEditVolunteer(v)}
                          >
                            {v.avatar_url ? (
                              <img
                                src={v.avatar_url}
                                alt=""
                                className="h-11 w-11 rounded-full object-cover shrink-0"
                              />
                            ) : (
                              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 shrink-0">
                                <User className="h-5 w-5 text-primary" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-medium truncate">{v.full_name}</p>
                                {!v.is_active && (
                                  <Badge variant="outline" className="text-[9px] shrink-0">Inativo</Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {v.phone || 'Sem telefone'}
                              </p>
                            </div>
                          </div>

                          {/* REDESIGN: saldo + botão Receber por voluntário */}
                          <div className="flex items-center gap-2 shrink-0">
                            {balance > 0 ? (
                              <>
                                <div className="text-right">
                                  <p className="text-[10px] text-muted-foreground">em aberto</p>
                                  <p className="financial-value text-sm text-warning">
                                    {formatCurrency(balance)}
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs border-warning/40 text-warning hover:bg-warning/10 hover:text-warning shrink-0"
                                  onClick={() => setSprPaymentOpen(true)}
                                >
                                  <DollarSign className="h-3 w-3 mr-1" />
                                  Pagar
                                </Button>
                              </>
                            ) : (
                              <div className="flex items-center gap-1 text-income text-xs">
                                <CheckCircle2 className="h-4 w-4" />
                                <span>Quite</span>
                              </div>
                            )}
                            <Pencil
                              className="h-4 w-4 text-muted-foreground ml-1 cursor-pointer"
                              onClick={() => openEditVolunteer(v)}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </TabsContent>

              {/* ── Fiados Tab ── */}
              <TabsContent value="charges" className="mt-0 space-y-2">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setChargeDialogOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" />
                    Lançar Fiado
                  </Button>
                </div>

                {loadingData ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredCharges.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    Nenhum fiado encontrado.
                  </p>
                ) : (
                  filteredCharges.map(c => (
                    <Card key={c.id} className={c.status === 'paid' ? 'opacity-60' : ''}>
                      <CardContent className="flex items-center justify-between p-4 gap-3">
                        {/* Volunteer avatar */}
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{c.volunteer_name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <p className="text-xs text-muted-foreground">
                                {c.description || 'Fiado'} • {formatDate(c.business_date)}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Amount + status + action */}
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="financial-value text-base">{formatCurrency(Number(c.amount))}</p>
                            <span
                              className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor(c.status)}`}
                            >
                              {statusLabel(c.status)}
                            </span>
                          </div>
                          {/* REDESIGN: Use SPRPaymentDialog for payment */}
                          {c.status !== 'paid' && (
                            <Button
                              size="sm"
                              className="h-9 text-xs shrink-0"
                              onClick={() => setSprPaymentOpen(true)}
                            >
                              <DollarSign className="h-3.5 w-3.5 mr-1" />
                              Receber
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>
            </div>
          </Tabs>
        </>
      )}

      {/* ── Volunteer Dialog ── */}
      <Dialog open={volDialogOpen} onOpenChange={setVolDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingVol ? 'Editar Voluntário' : 'Novo Voluntário'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Avatar */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                {volPreviewUrl ? (
                  <img
                    src={volPreviewUrl}
                    alt="Avatar"
                    className="h-24 w-24 rounded-full object-cover border-4 border-primary/20"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-muted border-4 border-dashed border-muted-foreground/30">
                    <User className="h-10 w-10 text-muted-foreground" />
                  </div>
                )}
                {volUploading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => volCameraRef.current?.click()}
                  className="gap-1.5"
                >
                  <Camera className="h-4 w-4" />
                  Câmera
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => volFileRef.current?.click()}
                  className="gap-1.5"
                >
                  <Upload className="h-4 w-4" />
                  Galeria
                </Button>
              </div>
              <input
                ref={volCameraRef}
                type="file"
                accept="image/*"
                capture="user"
                onChange={handleVolFileSelect}
                className="hidden"
              />
              <input
                ref={volFileRef}
                type="file"
                accept="image/*"
                onChange={handleVolFileSelect}
                className="hidden"
              />
            </div>

            <div className="space-y-3">
              <div>
                <Label>Nome Completo *</Label>
                <Input value={volName} onChange={e => setVolName(e.target.value)} className="h-12 mt-1" />
              </div>
              <div>
                <Label>Telefone</Label>
                <PhoneInput
                  value={volPhone}
                  onChange={setVolPhone}
                  placeholder="(11) 99999-9999"
                  className="h-12 mt-1"
                />
              </div>
              {editingVol && (
                <div className="flex items-center justify-between py-1">
                  <Label>Ativo</Label>
                  <Switch checked={volActive} onCheckedChange={setVolActive} />
                </div>
              )}
            </div>

            <Button className="h-12 w-full" onClick={saveVolunteer} disabled={volUploading}>
              {volUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                'Salvar'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Fiado Charge Dialog (PDV-style) ── */}
      <FiadoChargeDialog
        open={chargeDialogOpen}
        onOpenChange={setChargeDialogOpen}
        onChargeCreated={fetchAll}
      />

      {/* ── SPR Payment Dialog (multi-step) ── REDESIGN: usa componente completo */}
      <SPRPaymentDialog
        open={sprPaymentOpen}
        onOpenChange={setSprPaymentOpen}
        onPaymentComplete={fetchAll}
      />
    </div>
  );
}
